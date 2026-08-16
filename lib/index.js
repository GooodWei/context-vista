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

// ---- per-model 累计 + 帧增量计费 ----
// 投影只按 provider:model 累计四字段（不再分分钟）；计费由 onChanged 帧增量完成：
// 每次投影值变化，delta = 当前累计 - 上次累计，用「当前时刻」的峰谷与该模型价格
// 计费后累加，实现「每帧多出的 tokens × 当前时间」的加法计费。时间锚点是帧到达
// 时刻（Date.now()），而非 event.time，因此不再需要按分钟分桶。

function zeroBuckets() {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function addBuckets(a, b) {
  return {
    uncachedInputTokens: (a.uncachedInputTokens || 0) + (b.uncachedInputTokens || 0),
    outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
    cacheReadTokens: (a.cacheReadTokens || 0) + (b.cacheReadTokens || 0),
    cacheWriteTokens: (a.cacheWriteTokens || 0) + (b.cacheWriteTokens || 0),
  }
}

function subBuckets(a, b) {
  return {
    uncachedInputTokens: (a.uncachedInputTokens || 0) - (b.uncachedInputTokens || 0),
    outputTokens: (a.outputTokens || 0) - (b.outputTokens || 0),
    cacheReadTokens: (a.cacheReadTokens || 0) - (b.cacheReadTokens || 0),
    cacheWriteTokens: (a.cacheWriteTokens || 0) - (b.cacheWriteTokens || 0),
  }
}

function splitModelKey(modelKey) {
  const sep = modelKey.indexOf(':')
  return sep >= 0
    ? { provider: modelKey.slice(0, sep), model: modelKey.slice(sep + 1) }
    : { provider: 'default', model: modelKey }
}

// 把单个 usage 样本累加进 state（不可变，返回新 state 以触发投影订阅）。
// usage 字段与宿主 tokenUsage 投影对齐：inputTokens→uncachedInputTokens。
function applyUsageSample(state, event) {
  if (!event || event.type !== 'assistant/message') return state
  const usage = event.data && event.data.usage
  const source = event.data && event.data.message && event.data.message.source
  if (!usage || !source || !source.model) return state
  const provider = typeof source.provider === 'string' && source.provider !== '' ? source.provider : 'default'
  const modelKey = provider + ':' + source.model
  const add = {
    uncachedInputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    cacheReadTokens: usage.cacheReadTokens || 0,
    cacheWriteTokens: usage.cacheWriteTokens || 0,
  }
  // 防御：状态形状异常（如损坏的 checkpoint 恢复）时回退到空桶，绝不抛错。
  const byModel = (state && typeof state.byModel === 'object' && state.byModel) || {}
  const totals = (state && typeof state.totals === 'object' && state.totals) || zeroBuckets()
  const prevModel = byModel[modelKey] || zeroBuckets()
  return {
    byModel: {
      ...byModel,
      [modelKey]: addBuckets(prevModel, add),
    },
    totals: addBuckets(totals, add),
  }
}

// 从事件数组纯 fold 出 per-model 桶（复用于子代理 own-suffix 折叠，与投影 apply
// 共享同一份累加逻辑，保证投影值与聚合值口径一致）。
function foldOwnUsage(events) {
  let state = { byModel: {}, totals: zeroBuckets() }
  for (const event of events) state = applyUsageSample(state, event)
  return state
}

// 单桶计价：四字段 × 该模型价格 × 当前时刻（now）的峰谷。
function bucketCost(buckets, modelKey, pricing, routes, defaults, now) {
  const { provider, model } = splitModelKey(modelKey)
  const routeCfg = resolveRouteConfig(pricing, routes, provider, defaults)
  const peak = isPeak(now, routeCfg.timezone, routeCfg.peakWindows)
  const price = periodPrice(resolveModelEntry(routeCfg, model), peak)
  return estimateCost(buckets, price)
}

// 每模型一行（四字段求和），供表格展示。
function summarizeByModel(byModel) {
  const rows = []
  if (!byModel) return rows
  for (const modelKey of Object.keys(byModel)) {
    const { provider, model } = splitModelKey(modelKey)
    rows.push({ provider, model, totals: byModel[modelKey] || zeroBuckets() })
  }
  return rows
}

// 把桶并入聚合桶（原地修改 target）。
function mergeAggregate(target, source) {
  if (!source) return target
  for (const modelKey of Object.keys(source.byModel || {})) {
    target.byModel[modelKey] = addBuckets(target.byModel[modelKey] || zeroBuckets(), source.byModel[modelKey] || zeroBuckets())
  }
  if (source.totals) target.totals = addBuckets(target.totals, source.totals)
  return target
}

// ---- onChanged 帧增量计费累加器 ----
// 订阅 sessionProjections.onChanged：每次 contextVistaModelUsage 变化，计算
// delta（当前累计 - 上次累计），用「当前时刻」峰谷 + 该模型价格计费，累加进
// 归属会话（子代理按 header.parentSession 归到主对话）。
//
// 冷启动基线：投影 cell 是懒构建的——恢复的会话首次被 drive 时，会 fold 出
// 「当前事件之前」的全部历史累计。因此首帧必须用 foldOwnUsage 重算基线作减数，
// 否则历史用量会被误当成一帧增量计费（重启后主对话 self 会整段重复计费）。
function createCostAccumulator(getPricing, getRoutes) {
  const lastByModel = new Map() // sessionId -> byModel（累计快照）
  const costByOwner = new Map() // ownerSessionId -> { self, subagents }，各自 { byModel, total }

  // 首次观察某会话时的基线：该会话在「当前事件(seq)之前」的累计桶。
  // 新会话 slice(0, seq) 里没有 assistant/message → 空桶 → 首帧全额计费；
  // 恢复会话 → 历史累计作减数 → 只计当前事件这一帧。
  function baselineByModel(session, seq) {
    if (!Number.isInteger(seq) || seq <= 0 || !session || !Array.isArray(session.events)) return {}
    return foldOwnUsage(session.events.slice(0, seq)).byModel
  }

  function emptyBucketSet() {
    return { byModel: {}, totals: zeroBuckets() }
  }

  function entryFor(ownerId) {
    let e = costByOwner.get(ownerId)
    if (!e) {
      e = {
        self: { byModel: {}, total: 0, tokens: emptyBucketSet() },
        subagents: { byModel: {}, total: 0, tokens: emptyBucketSet() },
      }
      costByOwner.set(ownerId, e)
    }
    return e
  }

  function addCost(bucket, modelKey, cost) {
    bucket.byModel[modelKey] = (bucket.byModel[modelKey] || 0) + cost
    bucket.total += cost
  }

  // 把帧增量桶并入 tokens 累计（byModel + totals），与费用解耦：即使该模型
  // 无价（cost undefined/0），tokens 也要如实累计。
  function addTokens(tokens, modelKey, delta) {
    tokens.byModel[modelKey] = addBuckets(tokens.byModel[modelKey] || zeroBuckets(), delta)
    tokens.totals = addBuckets(tokens.totals, delta)
  }

  function onChanged(session, key, value, seq) {
    if (key !== 'contextVistaModelUsage' || !session) return
    // 热路径（投影 drive 内同步调用）：任何异常都吞掉，避免拖垮投影管线/会话 append。
    try {
      applyFrame(session, value, seq)
    } catch (err) {
      // 计费/归属失败不影响主流程（此处不重新抛出，防止污染其它插件的投影驱动）。
    }
  }

  function applyFrame(session, value, seq) {
    const byModel = value && value.byModel
    if (!byModel) return
    const had = lastByModel.has(session.id)
    const prev = had ? (lastByModel.get(session.id) || {}) : baselineByModel(session, seq)
    lastByModel.set(session.id, byModel)

    // 子代理按 header.parentSession 归到主对话；否则计入自身。
    const isSub = !!(session.header && session.header.origin === 'subagent')
    const ownerId = isSub && session.header.parentSession ? session.header.parentSession : session.id
    const target = isSub ? entryFor(ownerId).subagents : entryFor(ownerId).self

    const pricing = getPricing()
    const routes = getRoutes()
    const now = new Date()
    let dirty = false
    for (const modelKey of Object.keys(byModel)) {
      const delta = subBuckets(byModel[modelKey] || zeroBuckets(), prev[modelKey] || zeroBuckets())
      if (delta.uncachedInputTokens <= 0 && delta.outputTokens <= 0 && delta.cacheReadTokens <= 0 && delta.cacheWriteTokens <= 0) continue
      addTokens(target.tokens, modelKey, delta)
      const cost = bucketCost(delta, modelKey, pricing.pricing, routes, pricing, now)
      if (cost !== undefined && cost > 0) addCost(target, modelKey, cost)
      dirty = true
    }
    if (dirty) touchSnapshot()
  }

  // ---- 快照（供投影下发到客户端）----
  // 返回 { ownerId: {self, subagents} } 的稳定引用；仅在聚合变化时重建，投影
  // apply 用 Object.is 检测引用变化以触发帧推送。entry 是活对象，快照里引用
  // 同一 entry，序列化到客户端时即当前值。
  let snapshotRef = buildSnapshot()
  function buildSnapshot() {
    const owners = {}
    for (const [id, entry] of costByOwner.entries()) owners[id] = entry
    return owners
  }
  function touchSnapshot() { snapshotRef = buildSnapshot() }
  function snapshot() { return snapshotRef }

  return {
    onChanged,
    costOf: (ownerId) => costByOwner.get(ownerId),
    snapshot,
  }
}

// ---- per-model 累计投影（会话自身事件）----
// 投影 view 是同步纯函数，只 fold 当前 session 的 assistant/message；计费不在这里
// 做，而是由 createCostAccumulator 订阅 onChanged 的帧增量完成（含子代理归属）。
const modelUsageProjectionDefinition = {
  key: 'contextVistaModelUsage',
  schema: { parse: (value) => value },
  init: () => ({ byModel: {}, totals: zeroBuckets() }),
  apply: (state, event) => applyUsageSample(state, event),
  view: (state) => ({ byModel: state.byModel, totals: state.totals }),
  stateVersion: 2,
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
    currentSession: '当前会话',
    includingSubagents: '含子代理',
    subagentUsage: '子代理消耗',
    subagentCount: '子代理会话',
    modelBreakdown: '按模型',
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
    currentSession: 'Current session',
    includingSubagents: 'Including subagents',
    subagentUsage: 'Subagent usage',
    subagentCount: 'Subagent sessions',
    modelBreakdown: 'By model',
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
  // assemblies that mount neither the meter nor the projection seam. 防御：get
  // 抛错时降级为 undefined，保证 apply 不因缺服务而崩。
  let tokenMeter
  let projections
  try {
    tokenMeter = ctx.get('tokenMeter')
    projections = ctx.get('sessionProjections')
  } catch (err) {
    tokenMeter = undefined
    projections = undefined
  }

  // ---- configurable pricing (built-in base < cordis config < settings.yaml) ----
  const entry = mergeEntry(BUILTIN_CONFIG, config || {})
  let current = () => entry
  let pricing = entry
  let routes = buildRoutes(ctx)
  let pricingValue = makePricingValue(pricing, routes)
  try {
    installSettingsSection(ctx, NS, Config, entry, {
      setSource: (source) => { current = source },
      onChange: () => {
        pricing = current()
        routes = buildRoutes(ctx)
        pricingValue = makePricingValue(pricing, routes)
      },
    })
  } catch (err) {
    // settings 服务缺失/不兼容时降级：仍用内置定价 + cordis config 运行，插件不崩。
  }

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
  // ---- 帧增量计费累加器（onChanged）----
  // 订阅投影变化，每次 contextVistaModelUsage 变化时用「帧增量 × 当前峰谷」计费，
  // 子代理按 header.parentSession 归到主对话。
  const accumulator = createCostAccumulator(() => pricing, () => routes)

  // 子代理聚合下发投影：view 读累加器最新快照（全局 map，按 owner session id
  // 索引），客户端据此查自己会话的子代理 tokens + 费用。投影 cell 是懒构建的，
  // 注册在 modelUsage 之后，保证同一事件驱动时 modelUsage 的 onChanged 先更新
  // 累加器、再让本投影 apply 返回新快照引用触发帧推送。
  const subagentAggregateProjectionDefinition = {
    key: 'contextVistaSubagent',
    schema: { parse: (value) => value },
    init: () => accumulator.snapshot(),
    apply: (state) => (state === accumulator.snapshot() ? state : accumulator.snapshot()),
    view: () => accumulator.snapshot(),
    stateVersion: 1,
  }

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    if (!projectionCtx || !projectionCtx.sessionProjections) return
    try {
      projectionCtx.sessionProjections.register(pricingProjectionDefinition)
      projectionCtx.sessionProjections.register(modelUsageProjectionDefinition)
      projectionCtx.sessionProjections.register(subagentAggregateProjectionDefinition)
      if (typeof projectionCtx.sessionProjections.onChanged === 'function') {
        projectionCtx.sessionProjections.onChanged(accumulator.onChanged)
      }
    } catch (err) {
      // 投影注册失败不影响插件其它功能（/context 文本仍可用，仅富卡片/计费降级）。
    }
  })

  ctx.effect(() => ctx.commands.register({
    name: 'context',
    description: 'Show current context token usage and allocation',
    handler: async (invocation) => {
      try {
      if (invocation.rawInput.trim().length > 0) {
        return { kind: 'error', text: t(resolveLocale(ctx), 'usageError') }
      }

      const lang = resolveLocale(ctx)
      const session = invocation.agent.session
      const values = projections ? projections.snapshot(session).values : {}
      const pressure = values.contextPressure
      const breakdown = values.contextBreakdown
      const usage = values.tokenUsage
      const modelUsage = values.contextVistaModelUsage
      const measurement = tokenMeter ? tokenMeter.measure(session) : undefined
      const capacity = await resolveCapacity(ctx, invocation.agent, pressure)
      const cfg = pricing || BUILTIN_CONFIG
      const currency = (cfg && cfg.currency) || DEFAULT_CURRENCY

      // 父会话自身的 per-model 用量（四字段累计）。
      const ownByModel = modelUsage && modelUsage.byModel

      // 帧增量计费累加结果：{ self, subagents }，各自 { byModel, total }。
      const costEntry = accumulator.costOf(session.id)
      const selfCost = costEntry && costEntry.self
      const subagentCost = costEntry && costEntry.subagents
      const hasSubagents = !!(subagentCost && subagentCost.total > 0)
      const totalCost = (selfCost ? selfCost.total : 0) + (subagentCost ? subagentCost.total : 0)

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
        lines.push(t(lang, 'currentSession') + ': ' + t(lang, 'input') + ' ' + fmt(usage.uncachedInputTokens) +
          ' · ' + t(lang, 'output') + ' ' + fmt(usage.outputTokens) +
          ' · ' + t(lang, 'cacheRead') + ' ' + fmt(usage.cacheReadTokens) +
          ' · ' + t(lang, 'cacheWrite') + ' ' + fmt(usage.cacheWriteTokens))
      }
      // 子代理消耗（tokens + 费用），按帧增量归属到当前会话。
      const subTokens = subagentCost && subagentCost.tokens ? subagentCost.tokens.totals : null
      const hasSubagentTokens = !!(subTokens && (
        (subTokens.uncachedInputTokens || 0) > 0 || (subTokens.outputTokens || 0) > 0 ||
        (subTokens.cacheReadTokens || 0) > 0 || (subTokens.cacheWriteTokens || 0) > 0
      ))
      if (hasSubagents || hasSubagentTokens) {
        lines.push(t(lang, 'subagentUsage') + ':')
        if (hasSubagentTokens) {
          lines.push('  ' + t(lang, 'input') + ' ' + fmt(subTokens.uncachedInputTokens) +
            ' · ' + t(lang, 'output') + ' ' + fmt(subTokens.outputTokens) +
            ' · ' + t(lang, 'cacheRead') + ' ' + fmt(subTokens.cacheReadTokens) +
            ' · ' + t(lang, 'cacheWrite') + ' ' + fmt(subTokens.cacheWriteTokens))
        }
        if (subagentCost && subagentCost.total > 0) {
          lines.push('  ' + t(lang, 'estimatedCost') + ': ' + fmtCost(subagentCost.total, currency))
        }
      }
      const rows = summarizeByModel(ownByModel)
      if (rows.length > 0) {
        lines.push(t(lang, 'modelBreakdown') + ':')
        for (const row of rows) {
          const key = row.provider + ':' + row.model
          const rowTotal = ((selfCost && selfCost.byModel[key]) || 0) + ((subagentCost && subagentCost.byModel[key]) || 0)
          lines.push('  ' + row.model + ' @ ' + row.provider + ': ' +
            t(lang, 'input') + ' ' + fmt(row.totals.uncachedInputTokens) +
            ' · ' + t(lang, 'output') + ' ' + fmt(row.totals.outputTokens) +
            ' · ' + t(lang, 'cacheRead') + ' ' + fmt(row.totals.cacheReadTokens) +
            ' · ' + t(lang, 'cacheWrite') + ' ' + fmt(row.totals.cacheWriteTokens) +
            (rowTotal > 0 ? ' · ' + fmtCost(rowTotal, currency) : ''))
        }
      }
      if (totalCost > 0) {
        if (hasSubagents) {
          lines.push(t(lang, 'estimatedCost') + ': ' + fmtCost(selfCost ? selfCost.total : 0, currency) + ' (' + t(lang, 'currentSession') + ')')
          lines.push(t(lang, 'estimatedCost') + ': ' + fmtCost(totalCost, currency) + ' (' + t(lang, 'includingSubagents') + ')')
        } else {
          lines.push(t(lang, 'estimatedCost') + ': ' + fmtCost(totalCost, currency))
        }
      }

      return { kind: 'success', text: lines.join('\n') }
      } catch (err) {
        // 命令执行异常只让 /context 报错，不影响 dsh 主流程。
        return { kind: 'error', text: 'context-vista: ' + (err && err.message ? err.message : String(err)) }
      }
    },
  }))
}

// 导出纯函数供单元测试（不改变插件装载行为）。
export {
  zeroBuckets,
  addBuckets,
  subBuckets,
  splitModelKey,
  applyUsageSample,
  foldOwnUsage,
  bucketCost,
  summarizeByModel,
  mergeAggregate,
  createCostAccumulator,
}
