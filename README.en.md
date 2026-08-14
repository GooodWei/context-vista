<div align="center">

<img src="pic.png" alt="context-vista — /context donut chart" width="100%">

<br>
</div>

<p align="center"><a href="./README.md">中文</a> · English</p>

# context-vista

> See your context window at a glance — token usage, compaction savings, and cost estimates, all in one view.

A `/context` slash command for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that shows the current context token usage and allocation as a **donut chart** — the DeepSeek Harness counterpart of Claude Code's `/context`.

- **Host half**: registers the `/context` command and returns a text summary (usable in headless / non-Web surfaces).
- **Client half**: upgrades the Web `/context` command row into a card with:
  - **Context composition donut**: system prompt / tool schemas / messages, plus a gray "free" (unused) remainder; the whole ring = the context window.
  - **Compaction effect donut**: after `/compact`, shows how much the latest compaction freed vs. kept.
  - **Occupancy bar**: projected next-request occupancy vs. the context window, with a percentage.
  - **Session totals + estimated cost**: input / output / cache read / cache write, plus a cost estimate based on official DeepSeek pricing.
  - **Persistent right-side floating card**: a mini, **live-updating** card pinned to the blank right side of the conversation area — no need to type `/context`. It shows:
    - **Mini donut**: current occupancy percentage in the center, with system / tools / messages / free segments around the ring.
    - **Legend**: token counts for each segment.
    - **Projected occupancy**: `projected ÷ context window` tokens.
    - **Estimated cost**: cost for the current model and peak/off-peak period, with a `model @ route · peak/off-peak` label.
    - Drag the title bar to move it vertically (position is remembered); click the arrow to collapse/expand.

> The donut chart is **hand-written SVG** with no third-party chart library.

## Installation

First install pnpm (a JavaScript package manager, similar to npm/yarn). `dsh plugin add` invokes pnpm internally, so do **not** write `pnpm dsh plugin ...`. If you don't have pnpm, run `npm install -g pnpm`.

> The commands below use the full `npx @deepseek-ai/dsh ...` form (no global install needed). If you've installed globally (`npm install -g @deepseek-ai/dsh`), you can shorten `npx @deepseek-ai/dsh` to `dsh`.

### Install from GitHub (recommended)

Copy and run these two commands:

```sh
npx @deepseek-ai/dsh plugin --profile web add github:GooodWei/context-vista
npx @deepseek-ai/dsh web
```

> If pnpm complains that it blocked a `prepare` script, add that key to the profile directory's `pnpm-workspace.yaml` under `allowBuilds` as prompted, then rerun the `add` command.

### Install from a local directory (for development)

```sh
npx @deepseek-ai/dsh plugin --profile web add file:../context-vista
npx @deepseek-ai/dsh web
```

The `file:` path is relative to the directory you run the command from.

## Usage

Once installed, type `/context` in the input box and press Enter.

The plugin also pins a mini floating card to the **right side of the conversation area** that updates live with no action needed. From top to bottom it shows:

1. **Title + collapse button** (`▸` collapses to a one-line title, `◂` expands);
2. **Mini donut**: occupancy percentage in the center, with system / tools / messages / free segments and a legend below;
3. **Projected occupancy**: `projected ÷ context window` tokens;
4. **Estimated cost**: the amount plus a small `model @ route · peak/off-peak` label.

**Drag the title bar** to move it vertically; the position is remembered (stored in browser localStorage and restored after refresh).

## Internationalization

The UI follows your **system/browser language** by default: Chinese (`zh`) or English (`en`). You can override it in the Web UI under **Settings → Language**. The `/context` command's text output (headless) follows the same preference, falling back to your system locale and then to Chinese.

## Data source & semantics

The client does no computation itself — it reads session projections the host has already computed and pushed (`useProjection`):

| Displayed item | projection key | semantics |
|---|---|---|
| Composition donut | `contextBreakdown` | system / tools / messages, a fixed heuristic (4 chars ≈ 1 token) — an **estimate** |
| Occupancy bar | `contextPressure` | `projectedTokens` ÷ `contextWindow` |
| Session totals | `tokenUsage` | **exact** provider cumulative: input / output / cache read / cache write |
| Estimated cost | same + current route/model | the buckets above × unit price (built-in official or custom, ¥/1M tokens), an **estimate** |

These are capabilities already mounted by the DSH default profile (`dsh-token-meter` + `dsh-session-projection`); this plugin needs no custom Host RPC.

### Notes

- `contextBreakdown` is a heuristic estimate and **undercounts CJK text and JSON schema**; the provider parts of `tokenUsage` / `contextPressure` are the exact values. Treat the two separately.
- Occupancy is a user-facing reference number (not billing, not a gating input); a brief mismatch may appear right after switching models.

### Cost estimate

cost = `uncachedInputTokens×miss + (cacheReadTokens+cacheWriteTokens)×hit + outputTokens×output`, ÷ 1,000,000. The current period (peak/off-peak) decides which unit-price set applies.

- Built-in official pricing (¥/1M tokens, key = provider route name → model name):
  - `deepseek-official` / `deepseek-v4-pro`: peak hit 0.3 / miss 9 / output 27; off-peak half 0.15 / 4.5 / 13.5
  - `deepseek-official` / `deepseek-v4-flash`: peak hit 0.1 / miss 3 / output 9; off-peak half 0.05 / 1.5 / 4.5
  - Unmatched models are billed at the pro tier.
- **Peak/off-peak windows**: by default Beijing time (UTC+8) peak 9:00–12:00 and 14:00–18:00, off-peak otherwise; timezone and windows are configurable (below).
- Because `tokenUsage` is cumulative with no per-request timestamps, the whole session is estimated at the **current moment's** rate; sessions spanning peak/off-peak are approximate.
- The amount is an **estimate**, not a bill.

#### Custom pricing

Edit `~/.dsh/settings.yaml` and override or add pricing under the `context-vista` namespace (**hot-reloaded, no restart needed**).

**Minimal example** (append to the end of `~/.dsh/settings.yaml`):

```yaml
context-vista:
  pricing:
    "https://api.deepseek.com":
      deepseek-v4-pro:
        peak:    { hit: 0.3, miss: 9, output: 27 }
        offpeak: { hit: 0.15, miss: 4.5, output: 13.5 }
```

> This only overrides `deepseek-v4-pro`; other models keep the built-in official pricing.

**Full example** (timezone, peak/off-peak windows, custom endpoint, wildcard fallback):

```yaml
context-vista:
  timezone: 8                        # timezone of the peak/off-peak windows (UTC offset); default 8 = Beijing time
  peakWindows:                       # peak windows, HH:MM, inclusive start, exclusive end; start > end means crossing midnight
    - start: "09:00"
      end: "12:00"
    - start: "14:00"
      end: "18:00"
  pricing:                           # key = route name or baseURL → model name → price; * wildcard supported
    "https://api.deepseek.com":      # literal baseURL key (overrides one model of the built-in route; the rest stay unchanged)
      deepseek-v4-pro:
        peak:    { hit: 0.3, miss: 9, output: 27 }
        offpeak: { hit: 0.15, miss: 4.5, output: 13.5 }
    "https://my-gateway.example.com/v1":  # custom endpoint, keyed by baseURL
      my-model:
        peak:    { hit: 1, miss: 5, output: 20 }
        offpeak: { hit: 0.5, miss: 2.5, output: 10 }
    "*":                              # fallback: models not listed individually under any route
      "*": { hit: 0.3, miss: 9, output: 27 }
```

- **Two ways to write a pricing key**:
  - **provider route name** (the "API route" in Models settings; the built-in DeepSeek is `deepseek-official`);
  - **literal baseURL** (e.g. `https://api.deepseek.com`) — the plugin resolves a `provider → baseURL` mapping from the LLM adapter's configurable providers to match it.
  - Keys containing `:` (baseURLs) **must be quoted** in YAML, otherwise they're parsed as comments/colon syntax.
- Two ways to write a price entry: **flat** `{ hit, miss, output }` (no peak split), or **peak/off-peak** `{ peak, offpeak }` (each `{ hit, miss, output }`; you may provide only one).
- Match order: `baseURL.model` → `baseURL.*` → `provider.model` → `provider.*` → `*.model` → `*.*` → built-in default (model name containing `flash` → flash tier, otherwise pro).
- If a provider's baseURL can't be resolved (non-configurable provider, or no baseURL in settings), a baseURL-keyed entry falls back to matching the provider route name.
- The headless command takes effect immediately; the Web card refreshes on the next session event (e.g. send another message or run `/context` again).

## License

MIT
