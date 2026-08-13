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
const DEFAULT_PEAK_WINDOWS = [
  { start: '09:00', end: '12:00' },
  { start: '14:00', end: '18:00' },
]
const BUILTIN_PRICING = {
  'deepseek-official': {
    'deepseek-v4-pro': {
      peak: { hit: 0.3, miss: 9, output: 27 },
      offpeak: { hit: 0.15, miss: 4.5, output: 13.5 },
    },
    'deepseek-v4-flash': {
      peak: { hit: 0.1, miss: 3, output: 9 },
      offpeak: { hit: 0.05, miss: 1.5, output: 4.5 },
    },
  },
}
const BUILTIN_CONFIG = {
  timezone: DEFAULT_TIMEZONE,
  peakWindows: DEFAULT_PEAK_WINDOWS,
  pricing: BUILTIN_PRICING,
}

// ---- Settings schema (schemastery) ----
const NS = settingsNamespace('context-vista')
const priceSchema = z.object({
  hit: z.number().min(0),
  miss: z.number().min(0),
  output: z.number().min(0),
})
export const Config = z.object({
  // 峰谷时段所在时区（相对 UTC 的小时偏移）。默认 +8 北京时间。
  timezone: z.number().min(-12).max(14).default(DEFAULT_TIMEZONE),
  // 高峰时段窗口，HH:MM（含起点、不含终点）。可跨午夜（start > end 表示跨天）。
  peakWindows: z.array(z.object({
    start: z.string().required(),
    end: z.string().required(),
  })).default(DEFAULT_PEAK_WINDOWS),
  // 路由名 → 模型名 → 价格。价格条目二选一：
  //   平坦：{ hit, miss, output }
  //   峰谷：{ peak: {hit,miss,output}, offpeak: {hit,miss,output} }（可只给其中一个）
  // 支持 `*` 作为路由名或模型名的通配符。
  pricing: z.dict(z.dict(z.object({
    hit: z.number().min(0),
    miss: z.number().min(0),
    output: z.number().min(0),
    peak: priceSchema,
    offpeak: priceSchema,
  }))).default({}),
})

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

function fmtCost(value) {
  if (!isNum(value)) return 'n/a'
  if (value >= 1) return '¥' + value.toFixed(2)
  if (value >= 0.01) return '¥' + value.toFixed(4)
  return '¥' + value.toFixed(6)
}

// ---- pricing resolution (keep in sync with lib/client.js) ----
// 定价键既可以是 provider 路由名，也可以是字面 baseURL。解析顺序：
//   baseURL(若可解析) → provider → '*' → 内置官价兜底。
function entryForKey(pricing, key, model) {
  const byKey = pricing ? pricing[key] : undefined
  if (byKey) {
    if (byKey[model] != null) return byKey[model]
    if (byKey['*'] != null) return byKey['*']
  }
  return undefined
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

function resolvePrice(pricing, routes, provider, model, peak) {
  const keys = []
  if (routes && provider && routes[provider]) keys.push(routes[provider])
  if (provider) keys.push(provider)
  keys.push('*')
  for (const key of keys) {
    const got = periodPrice(entryForKey(pricing, key, model), peak)
    if (got) return got
  }
  // 未命中时回退到内置官价：模型名含 flash 按 flash，否则 pro。
  const modelKey = String(model || '').toLowerCase()
  const fallbackModel = modelKey.includes('flash') ? 'deepseek-v4-flash' : 'deepseek-v4-pro'
  return periodPrice(entryForKey(BUILTIN_PRICING, 'deepseek-official', fallbackModel), peak)
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
    pricing: cfg.pricing,
    routes,
  }
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
        return { kind: 'error', text: 'Usage: /context (no arguments)' }
      }

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
      const peak = isPeak(now, cfg.timezone, cfg.peakWindows)
      const price = resolvePrice(cfg.pricing, routes, provider, model, peak)
      const cost = estimateCost(usage, price)

      const lines = ['Context usage']
      lines.push('Context window: ' + fmt(capacity) + ' tokens')
      if (isNum(pressure && pressure.projectedTokens)) {
        lines.push('Projected next request: ' + fmt(pressure.projectedTokens) + ' tokens (' + pct(pressure.projectedTokens, capacity) + ')')
      }
      if (isNum(pressure && pressure.pressureTokens)) {
        lines.push('Last request prompt: ' + fmt(pressure.pressureTokens) + ' tokens (' + pct(pressure.pressureTokens, capacity) + ')')
      }
      if (measurement && isNum(measurement.surfaceTokens)) {
        lines.push('Current surface (estimate): ' + fmt(measurement.surfaceTokens) + ' tokens')
      }
      if (breakdown) {
        lines.push('Composition (estimate): system ' + fmt(breakdown.systemTokens) +
          ' · tools ' + fmt(breakdown.toolsTokens) +
          ' · messages ' + fmt(breakdown.messageTokens))
      }
      if (usage) {
        lines.push('Session totals: input ' + fmt(usage.uncachedInputTokens) +
          ' · output ' + fmt(usage.outputTokens) +
          ' · cache read ' + fmt(usage.cacheReadTokens) +
          ' · cache write ' + fmt(usage.cacheWriteTokens))
      }
      if (cost !== undefined) {
        const route = model || 'default'
        const routeLabel = provider ? route + ' @ ' + provider : route
        lines.push('Estimated cost: ' + fmtCost(cost) + ' (' + routeLabel + ', ' + (peak ? 'peak' : 'off-peak') + ')')
      }

      return { kind: 'success', text: lines.join('\n') }
    },
  }))
}
