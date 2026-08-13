// Host half of dsh-command-context: the `/context` slash command.
// Plain ESM JavaScript — no build step. The rich pie-chart presentation is the
// client half (`./client.js`), which reads the same session projections; this
// text result is the durable fallback for headless / non-Web surfaces.

export const name = 'dsh-command-context'
export const inject = ['commands']

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

// ---- Cost estimation (keep in sync with lib/client.js) ----
// DeepSeek 官方开放平台定价（人民币，每百万 tokens），高峰价：
//   flash: 缓存命中 0.1 / 未命中 3 / 输出 9
//   pro:   缓存命中 0.3 / 未命中 9 / 输出 27
// 峰谷时段（北京时间 UTC+8）：高峰 9:00–12:00、14:00–18:00，其余空闲半价。
const PRICING = {
  'deepseek-v4-pro': { miss: 9.0, hit: 0.3, output: 27.0 },
  'deepseek-v4-flash': { miss: 3.0, hit: 0.1, output: 9.0 },
}
const DEFAULT_PRICE = PRICING['deepseek-v4-pro']

function priceFor(model) {
  const key = String(model || '').toLowerCase()
  if (key.includes('flash')) return PRICING['deepseek-v4-flash']
  return PRICING['deepseek-v4-pro'] // pro / reasoner / chat / 未知 → pro
}

// 北京时间是否处于高峰时段。
function isPeakBeijing(now) {
  const bjMinutes = ((now.getUTCHours() + 8) % 24) * 60 + now.getUTCMinutes()
  return (bjMinutes >= 540 && bjMinutes < 720) || (bjMinutes >= 840 && bjMinutes < 1080)
}

function periodMultiplier(now) {
  return isPeakBeijing(now) ? 1.0 : 0.5
}

function estimateCost(usage, price, multiplier) {
  if (!usage || !price) return undefined
  const base = (
    (usage.uncachedInputTokens || 0) * price.miss +
    ((usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)) * price.hit +
    (usage.outputTokens || 0) * price.output
  ) / 1000000
  return base * (multiplier || 1)
}

function fmtCost(value) {
  if (!isNum(value)) return 'n/a'
  if (value >= 1) return '¥' + value.toFixed(2)
  if (value >= 0.01) return '¥' + value.toFixed(4)
  return '¥' + value.toFixed(6)
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

export function apply(ctx) {
  // Optional capabilities read through ctx.get so this command still loads in
  // assemblies that mount neither the meter nor the projection seam.
  const tokenMeter = ctx.get('tokenMeter')
  const projections = ctx.get('sessionProjections')

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
      const model = invocation.agent.options && invocation.agent.options.model
      const now = new Date()
      const cost = estimateCost(usage, priceFor(model), periodMultiplier(now))

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
        const period = isPeakBeijing(now) ? 'peak' : 'off-peak (half)'
        lines.push('Estimated cost: ' + fmtCost(cost) + ' (' + (model || 'default') + ', ' + period + ')')
      }

      return { kind: 'success', text: lines.join('\n') }
    },
  }))
}
