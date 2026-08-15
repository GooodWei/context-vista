// Host half of context-vista: the `/context` slash command.
// Plain ESM JavaScript — no build step. The rich pie-chart presentation is the
// client half (`./client.js`), which reads the same session projections; this
// text result is the durable fallback for headless / non-Web surfaces.
//
// Pricing is user-configurable through the harness settings seam
// (`~/.dsh/settings.yaml`, namespace `context-vista`). The built-in
// official DeepSeek pricing is the composition `base`; a user section merges
// on top, so custom providers/models ADD to the built-in table and can
// override it key by key. The resolved pricing is pushed to the web client
// through the `contextPricing` session projection. Keep the pricing constants
// and resolution rules in sync with `lib/client.js`.

import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'context-vista'
export const inject = ['commands']

// ---- Pricing constants (keep in sync with lib/client.js) ----
// DeepSeek 官方开放平台定价（人民币，每百万 tokens）。高峰价 + 空闲半价（折成
// 显式的 offpeak 单价，避免任何乘系数逻辑）。键 = provider 路由名（DSH 模型
// 配置里的「API 路由」，如 deepseek-official）；会话日志只携带 provider + model，
// 不携带 baseURL，因此定价按「路由名 → 模型名 → 价格」组织。
const DEFAULT_TIMEZONE = 8 // 东八区（北京时间）
const DEFAULT_CURRENCY = '¥' // 估算费用显示的货币单位（仅影响显示，不参与计价）
const DEFAULT_PEAK_WINDOWS = [
  { start: '09:00', end: '12:00' },
  { start: '14:00', end: '18:00' },
]
const BUILTIN_PRICING = {
  'deepseek-official': {
    currency: '¥',
    timezone: 8,
    peakWindows: [
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
    models: {
      'deepseek-v4-pro': {
        peak: { hit: 0.3, miss: 9, output: 27 },
        offpeak: { hit: 0.15, miss: 4.5, output: 13.5 },
      },
      'deepseek-v4-flash': {
        peak: { hit: 0.1, miss: 3, output: 9 },
        offpeak: { hit: 0.05, miss: 1.5, output: 4.5 },
      },
    },
  },
}
const BUILTIN_CONFIG = {
  timezone: DEFAULT_TIMEZONE,
  peakWindows: DEFAULT_PEAK_WINDOWS,
  currency: DEFAULT_CURRENCY,
  pricing: BUILTIN_PRICING,
}

// ---- Settings schema (schemastery) ----
const NS = settingsNamespace('context-vista')
// schemastery 各版本 API 有差异（如 3.18 移除了 .optional()）。schema 在模块顶层
// 构造，一旦抛错会直接让整个 harness 启动失败、用户无法使用。这里用 try-catch 兜底：
// 构造失败时降级为空 schema，插件仍能加载（定价回落内置默认），只告警不拖垮宿主。
let Config
try {
  const priceSchema = z.object({
    hit: z.number().min(0),
    miss: z.number().min(0),
    output: z.number().min(0),
  })
  const modelPriceSchema = z.object({
    hit: z.number().min(0),
    miss: z.number().min(0),
    output: z.number().min(0),
    peak: priceSchema,
    offpeak: priceSchema,
  })
  Config = z.object({
    // 全局默认（各路由可用同名字段覆盖）：峰谷时区、高峰窗口、货币单位。
    timezone: z.number().min(-12).max(14).default(DEFAULT_TIMEZONE),
    peakWindows: z.array(z.object({
      start: z.string().required(),
      end: z.string().required(),
    })).default(DEFAULT_PEAK_WINDOWS),
    currency: z.string().default(DEFAULT_CURRENCY),
    // 定价表：路由名/baseURL → { currency?, timezone?, peakWindows?, models }。
    // 货币单位与峰谷定义（时区 + 高峰窗口）都跟随 API（路由），路由级覆盖全局默认。
    // 模型价格条目二选一：平坦 { hit, miss, output }，或峰谷 { peak, offpeak }。
    // 支持 `*` 作为路由名或模型名的通配符。
    pricing: z.dict(z.object({
      currency: z.string().required(false),
      timezone: z.number().min(-12).max(14).required(false),
      peakWindows: z.array(z.object({
        start: z.string().required(),
        end: z.string().required(),
      })).required(false),
      models: z.dict(modelPriceSchema).required(),
    })).default({}),
  })
} catch (err) {
  console.error('[context-vista] 配置 schema 构造失败，已降级为空 schema（定价回落内置默认）：', err)
  Config = z.object({})
}
export { Config }

// ---- helpers ----
function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function fmt(value) {
  return isNum(value) ? String(Math.round(value)) : 'n/a'
}

function pct(part, whole) {
  if (!isNum(part) || !isNum(whole) || whole <= 0) return 'n/a'
  return ((part / whole) * 100).toFixed(1) + '%'
}

function fmtCost(value, currency) {
  if (!isNum(value)) return 'n/a'
  const unit = typeof currency === 'string' && currency !== '' ? currency : DEFAULT_CURRENCY
  if (value >= 1) return unit + value.toFixed(2)
  if (value >= 0.01) return unit + value.toFixed(4)
  return unit + value.toFixed(6)
}

// ---- pricing resolution (keep in sync with lib/client.js) ----
// 定价键既可以是 provider 路由名，也可以是字面 baseURL。解析顺序：
//   baseURL(若可解析) → provider → '*' → 内置官价兜底。
// 货币单位与峰谷定义（时区 + 高峰窗口）都跟随 API（路由）。

function normalizeRoute(entry, defaults) {
  return {
    currency: (entry?.currency) ?? (defaults?.currency) ?? DEFAULT_CURRENCY,
    timezone: (entry?.timezone) ?? (defaults?.timezone) ?? DEFAULT_TIMEZONE,
    peakWindows: (entry?.peakWindows) ?? (defaults?.peakWindows) ?? DEFAULT_PEAK_WINDOWS,
    models: (entry && entry.models) || {},
  }
}

function resolveRouteConfig(pricing, routes, provider, defaults) {
  const keys = []
  if (routes && provider && routes[provider]) keys.push(routes[provider])
  if (provider) keys.push(provider)
  keys.push('*')
  for (const key of keys) {
    const entry = pricing ? pricing[key] : undefined
    if (entry && entry.models) return normalizeRoute(entry, defaults)
  }
  return normalizeRoute(BUILTIN_PRICING['deepseek-official'], defaults)
}

function resolveModelEntry(routeConfig, model) {
  const models = (routeConfig && routeConfig.models) || {}
  if (models[model] != null) return models[model]
  if (models['*'] != null) return models['*']
  // 模型名含 flash 按 flash，否则 pro（针对内置 DeepSeek 路由的兜底）。
  const modelKey = String(model || '').toLowerCase()
  const fallbackModel = modelKey.includes('flash') ? 'deepseek-v4-flash' : 'deepseek-v4-pro'
  return models[fallbackModel]
}

function periodPrice(entry, peak) {
  if (!entry) return undefined
  const hasSplit = entry.peak != null || entry.offpeak != null
  if (hasSplit) {
    const want = peak ? entry.peak : entry.offpeak
    const other = peak ? entry.offpeak : entry.peak
    return want != null ? want : other
  }
  return { hit: entry.hit ?? 0, miss: entry.miss ?? 0, output: entry.output ?? 0 }
}

function minutesOfDay(str) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim())
  if (!match) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

function isPeak(now, timezone, peakWindows) {
  const offset = typeof timezone === 'number' ? timezone : DEFAULT_TIMEZONE
  const windows = Array.isArray(peakWindows) && peakWindows.length > 0 ? peakWindows : DEFAULT_PEAK_WINDOWS
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
  const local = new Date(utcMs + offset * 3600000)
  const minutes = local.getHours() * 60 + local.getMinutes()
  for (const window of windows) {
    const start = minutesOfDay(window && window.start)
    const end = minutesOfDay(window && window.end)
    if (start == null || end == null) continue
    if (end > start) {
      if (minutes >= start && minutes < end) return true
    } else {
      if (minutes >= start || minutes < end) return true // 跨午夜窗口
    }
  }
  return false
}

function estimateCost(usage, price) {
  if (!usage || !price) return undefined
  return (
    ((usage.uncachedInputTokens || 0) * (price.miss || 0) +
      ((usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)) * (price.hit || 0) +
      (usage.outputTokens || 0) * (price.output || 0)
    ) / 1000000
  )
}

// 把内置官价 + 插件组合配置浅合并成 settings 的 base 层（provider 级合并，
// settings.yaml 用户层由 settings 服务的 mergeLayers 做深度合并）。
function mergeEntry(base, over) {
  const b = base || {}
  const o = over || {}
  return {
    timezone: o.timezone ?? b.timezone,
    peakWindows: o.peakWindows ?? b.peakWindows,
    currency: o.currency ?? b.currency,
    pricing: { ...(b.pricing || {}), ...(o.pricing || {}) },
  }
}

// 从某个可配置 provider 的 settings 配置里读出 baseURL。
function readProviderBaseURL(settings, entry) {
  if (!settings || !entry || !entry.settingsNs) return undefined
  let node
  try {
    node = settings.get(entry.settingsNs)
  } catch {
    return undefined
  }
  if (node == null) return undefined
  for (const segment of entry.settingsPath || []) {
    if (node == null) return undefined
    node = node[segment]
  }
  return node && typeof node.baseURL === 'string' && node.baseURL.length > 0 ? node.baseURL : undefined
}

// 构建 provider 路由名 → baseURL 映射，供按字面 baseURL 写定价键时命中。
function buildRoutes(ctx) {
  const routes = { 'deepseek-official': 'https://api.deepseek.com' }
  const llm = ctx.get('llm')
  const settings = ctx.get('settings')
  if (!llm || typeof llm.listConfigurableProviders !== 'function') return routes
  let providers
  try {
    providers = llm.listConfigurableProviders()
  } catch {
    return routes
  }
  for (const entry of providers || []) {
    if (!entry || !entry.provider) continue
    const baseURL = readProviderBaseURL(settings, entry)
    if (baseURL) routes[entry.provider] = baseURL
  }
  return routes
}

// 组装下发到客户端的定价快照（settings 配置 + 路由映射）。
function makePricingValue(cfg, routes) {
  return {
    timezone: cfg.timezone,
    peakWindows: cfg.peakWindows,
    currency: cfg.currency,
    pricing: cfg.pricing,
    routes,
  }
}

// ---- localization (host text output) ----
// 命令文本默认跟随系统语言（Node 进程 locale），也可被 Web 端「语言」设置
// （settings `locale.preference`）显式覆盖。兜底 zh，与 client 半部一致。
const I18N = {
  zh: {
    usageError: '用法：/context（不接受参数）',
    contextUsage: '上下文用量',
    contextWindow: '上下文窗口',
    projectedNext: '预计下一次请求',
    lastRequestPrompt: '上次请求提示词',
    currentSurface: '当前表层（估算）',
    composition: '组成（估算）',
    system: '系统',
    tools: '工具',
    messages: '消息',
    sessionTotals: '会话累计',
    input: '输入',
    output: '输出',
    cacheRead: '缓存读',
    cacheWrite: '缓存写',
    estimatedCost: '估算费用',
    tokens: 'tokens',
    peak: '高峰',
    offpeak: '空闲',
  },
  en: {
    usageError: 'Usage: /context (no arguments)',
    contextUsage: 'Context usage',
    contextWindow: 'Context window',
    projectedNext: 'Projected next request',
    lastRequestPrompt: 'Last request prompt',
    currentSurface: 'Current surface (estimate)',
    composition: 'Composition (estimate)',
    system: 'system',
    tools: 'tools',
    messages: 'messages',
    sessionTotals: 'Session totals',
    input: 'input',
    output: 'output',
    cacheRead: 'cache read',
    cacheWrite: 'cache write',
    estimatedCost: 'Estimated cost',
    tokens: 'tokens',
    peak: 'peak',
    offpeak: 'off-peak',
  },
}

function detectSystemLocale() {
  const raw = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || ''
  if (/^zh\b/i.test(raw)) return 'zh'
  if (/^en\b/i.test(raw)) return 'en'
  // Windows 通常不设 LANG/LC_*；退而用 Node Intl 的默认 locale 作为次要信号。
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale
    if (/^zh\b/i.test(locale)) return 'zh'
    if (/^en\b/i.test(locale)) return 'en'
  } catch {}
  return undefined
}

function resolveLocale(ctx) {
  // 1) Web 端显式语言选择（host settings `locale.preference`）。
  try {
    const settings = ctx.get('settings')
    const section = settings ? settings.get('locale') : undefined
    if (section && (section.preference === 'zh' || section.preference === 'en')) {
      return section.preference
    }
  } catch {}
  // 2) Node 进程系统语言。
  const sys = detectSystemLocale()
  if (sys) return sys
  // 3) 兜底，与 client FALLBACK_LOCALE 一致。
  return 'zh'
}

function t(lang, key) {
  const dict = I18N[lang] || I18N.zh
  return dict[key] ?? I18N.en[key] ?? key
}

// Capacity resolution: prefer the last recorded context window (from the
// contextPressure projection); fall back to the exact model route the agent is
// using when the projection has no capacity yet.
async function resolveCapacity(ctx, agent, pressure) {
  if (isNum(pressure && pressure.contextWindow)) return pressure.contextWindow
  const llm = ctx.get('llm')
  const options = agent && agent.options
  if (!llm || !options || !options.provider || !options.model) return undefined
  try {
    const info = await llm.resolveModelInfo(options.provider, options.model)
    return info && info.context ? info.context.contextWindow : undefined
  } catch {
    return undefined
  }
}

export function apply(ctx, config = {}) {
  // Optional capabilities read through ctx.get so this command still loads in
  // assemblies that mount neither the meter nor the projection seam.
  const tokenMeter = ctx.get('tokenMeter')
  const projections = ctx.get('sessionProjections')

  // ---- configurable pricing (built-in base < cordis config < settings.yaml) ----
  const entry = mergeEntry(BUILTIN_CONFIG, config || {})
  let current = () => entry
  let pricing = entry
  let routes = buildRoutes(ctx)
  let pricingValue = makePricingValue(pricing, routes)
  installSettingsSection(ctx, NS, Config, entry, {
    setSource: (source) => { current = source },
    onChange: () => {
      pricing = current()
      routes = buildRoutes(ctx)
      pricingValue = makePricingValue(pricing, routes)
    },
  })

  // ---- push the resolved pricing to the web client ----
  const pricingProjectionDefinition = {
    key: 'contextPricing',
    schema: { parse: (value) => value },
    init: () => pricingValue,
    // 仅在定价对象引用变化时返回新 state，驱动 session/projection 帧推送；
    // view 始终读闭包里的最新值，保证 tail-page 播种即新鲜。
    apply: (state) => (state === pricingValue ? state : pricingValue),
    view: () => pricingValue,
    stateVersion: 1,
  }
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(pricingProjectionDefinition)
  })

  ctx.effect(() => ctx.commands.register({
    name: 'context',
    description: 'Show current context token usage and allocation',
    handler: async (invocation) => {
      if (invocation.rawInput.trim().length > 0) {
        return { kind: 'error', text: t(resolveLocale(ctx), 'usageError') }
      }

      const lang = resolveLocale(ctx)
      const session = invocation.agent.session
      const values = projections ? projections.snapshot(session).values : {}
      const pressure = values.contextPressure
      const breakdown = values.contextBreakdown
      const usage = values.tokenUsage
      const measurement = tokenMeter ? tokenMeter.measure(session) : undefined
      const capacity = await resolveCapacity(ctx, invocation.agent, pressure)
      const options = invocation.agent.options || {}
      const provider = options.provider
      const model = options.model
      const now = new Date()
      const cfg = pricing || BUILTIN_CONFIG
      const routeCfg = resolveRouteConfig(cfg.pricing, routes, provider, cfg)
      const peak = isPeak(now, routeCfg.timezone, routeCfg.peakWindows)
      const price = periodPrice(resolveModelEntry(routeCfg, model), peak)
      const cost = estimateCost(usage, price)

      const lines = [t(lang, 'contextUsage')]
      lines.push(t(lang, 'contextWindow') + ': ' + fmt(capacity) + ' ' + t(lang, 'tokens'))
      if (isNum(pressure && pressure.projectedTokens)) {
        lines.push(t(lang, 'projectedNext') + ': ' + fmt(pressure.projectedTokens) + ' ' + t(lang, 'tokens') + ' (' + pct(pressure.projectedTokens, capacity) + ')')
      }
      if (isNum(pressure && pressure.pressureTokens)) {
        lines.push(t(lang, 'lastRequestPrompt') + ': ' + fmt(pressure.pressureTokens) + ' ' + t(lang, 'tokens') + ' (' + pct(pressure.pressureTokens, capacity) + ')')
      }
      if (measurement && isNum(measurement.surfaceTokens)) {
        lines.push(t(lang, 'currentSurface') + ': ' + fmt(measurement.surfaceTokens) + ' ' + t(lang, 'tokens'))
      }
      if (breakdown) {
        lines.push(t(lang, 'composition') + ': ' + t(lang, 'system') + ' ' + fmt(breakdown.systemTokens) +
          ' · ' + t(lang, 'tools') + ' ' + fmt(breakdown.toolsTokens) +
          ' · ' + t(lang, 'messages') + ' ' + fmt(breakdown.messageTokens))
      }
      if (usage) {
        lines.push(t(lang, 'sessionTotals') + ': ' + t(lang, 'input') + ' ' + fmt(usage.uncachedInputTokens) +
          ' · ' + t(lang, 'output') + ' ' + fmt(usage.outputTokens) +
          ' · ' + t(lang, 'cacheRead') + ' ' + fmt(usage.cacheReadTokens) +
          ' · ' + t(lang, 'cacheWrite') + ' ' + fmt(usage.cacheWriteTokens))
      }
      if (cost !== undefined) {
        const route = model || 'default'
        const routeLabel = provider ? route + ' @ ' + provider : route
        lines.push(t(lang, 'estimatedCost') + ': ' + fmtCost(cost, routeCfg.currency) + ' (' + routeLabel + ', ' + (peak ? t(lang, 'peak') : t(lang, 'offpeak')) + ')')
      }

      return { kind: 'success', text: lines.join('\n') }
    },
  }))
}
