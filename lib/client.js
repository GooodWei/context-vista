// Client half of context-vista: upgrades the durable `/context` command
// row into a card with an SVG donut chart (context composition) plus an
// occupancy bar and cumulative session totals. Plain JavaScript — no bundler.
//
// Data comes from the host-computed session projections, read through the
// framework's `useProjection` seat (no custom Host RPC required):
//   - contextBreakdown -> system / tools / messages heuristic composition
//   - contextPressure  -> projectedTokens / pressureTokens / contextWindow
//   - tokenUsage       -> cumulative provider buckets for the whole log
window.__ModuleLoader__.load({
  id: 'context-vista',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    var NS = 'context-vista';
    var inject = ['slots', 'locale', 'sessions'];

    var zh = {
      'title': '上下文用量',
      'window': '上下文窗口',
      'projected': '预计占用',
      'lastRequest': '上次请求',
      'surface': '当前表层（估算）',
      'composition': '上下文组成（估算）',
      'system': '系统提示词',
      'tools': '工具',
      'messages': '消息',
      'sessionTotals': '会话累计',
      'input': '输入',
      'output': '输出',
      'cacheRead': '缓存读',
      'cacheWrite': '缓存写',
      'free': '剩余',
      'cost': '估算费用',
      'estimateNote': '按 DeepSeek 官方定价估算，仅供参考',
      'peak': '高峰',
      'offpeak': '空闲（半价）',
      'compaction': '压缩效果（最近一次）',
      'compacted': '已压缩',
      'liveConv': '当前对话',
      'noData': '暂无 provider 用量数据（先发送一条消息即可）',
      'collapse': '收起',
      'expand': '展开',
    };
    var en = {
      'title': 'Context usage',
      'window': 'Context window',
      'projected': 'Projected',
      'lastRequest': 'Last request',
      'surface': 'Current surface (estimate)',
      'composition': 'Composition (estimate)',
      'system': 'System prompt',
      'tools': 'Tools',
      'messages': 'Messages',
      'sessionTotals': 'Session totals',
      'input': 'Input',
      'output': 'Output',
      'cacheRead': 'Cache read',
      'cacheWrite': 'Cache write',
      'free': 'Free',
      'cost': 'Estimated cost',
      'estimateNote': 'Estimate based on official DeepSeek pricing',
      'peak': 'Peak',
      'offpeak': 'Off-peak (half)',
      'compaction': 'Compaction effect (latest)',
      'compacted': 'Compacted',
      'liveConv': 'Live conversation',
      'noData': 'No provider usage data yet — send a message first.',
      'collapse': 'Collapse',
      'expand': 'Expand',
    };

    // ---- Styles, themed through the real --dsw-* tokens shipped by the shell ----
    var css = [
      '.dcc-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);max-width:560px}',
      '.dcc-header{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
      '.dcc-title{font-size:13px;font-weight:600;line-height:20px}',
      '.dcc-window{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:20px}',
      '.dcc-body{display:flex;gap:16px;align-items:center}',
      '.dcc-donut{width:120px;height:120px;flex:none}',
      '.dcc-legend{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}',
      '.dcc-legend-row{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px}',
      '.dcc-dot{width:8px;height:8px;border-radius:999px;flex:none}',
      '.dcc-legend-label{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dcc-legend-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.dcc-section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-caption);line-height:16px}',
      '.dcc-bar-track{height:8px;border-radius:999px;background:var(--dsw-alias-border-l2);overflow:hidden}',
      '.dcc-bar-fill{height:100%;border-radius:999px;background:#3b82f6;transition:width .2s ease}',
      '.dcc-bar-row{display:flex;justify-content:space-between;font-size:12px;line-height:18px;margin-top:6px}',
      '.dcc-bar-nums{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dcc-bar-pct{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}',
      '.dcc-totals{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}',
      '.dcc-total{display:flex;justify-content:space-between;font-size:12px;line-height:18px}',
      '.dcc-total-label{color:var(--dsw-alias-label-secondary)}',
      '.dcc-total-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.dcc-empty{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dcc-cost{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;margin-top:4px}',
      '.dcc-cost-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dcc-cost-value{font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.dcc-cost-note{font-size:11px;color:var(--dsw-alias-label-caption);line-height:16px;margin-top:2px}',
      // Persistent right-side HUD (shell.overlay).
      '.dcc-hud{box-sizing:border-box;position:absolute;right:14px;width:224px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.10);pointer-events:auto;z-index:21}',
      '.dcc-hud-collapsed{width:auto;padding:8px 10px;gap:0}',
      '.dcc-hud-head{display:flex;align-items:center;justify-content:space-between;gap:6px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}',
      '.dcc-hud-dragging .dcc-hud-head{cursor:grabbing}',
      '.dcc-hud-title{font-size:12px;font-weight:600;line-height:16px}',
      '.dcc-hud-toggle{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;padding:0;font-size:12px;line-height:1}',
      '.dcc-hud-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dcc-hud-donut{width:108px;height:108px;margin:0 auto;display:block}',
      '.dcc-donut-center{fill:var(--dsw-alias-label-primary);font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}',
      '.dcc-hud-foot{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}',
      '.dcc-hud-row{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:16px}',
      '.dcc-hud-row-l{color:var(--dsw-alias-label-secondary);flex:none}',
      '.dcc-hud-row-v{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dcc-hud-cost{font-size:14px;font-weight:700}',
      '.dcc-hud-note{font-size:10px;color:var(--dsw-alias-label-caption);line-height:14px}'
    ].join('\n');

    var tagId = 'context-vista/context.css';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      var styleTag = document.createElement('style');
      styleTag.dataset.plugin = 'context-vista';
      styleTag.dataset.pluginCss = tagId;
      styleTag.textContent = css;
      document.head.appendChild(styleTag);
    }

    // ---- helpers ----
    function isNum(value) { return typeof value === 'number' && Number.isFinite(value); }
    function fmt(value) { return isNum(value) ? String(Math.round(value)) : '–'; }
    function compact(value) {
      if (!isNum(value)) return '–';
      if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
      if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
      return String(Math.round(value));
    }
    function clamp01(x) { return Math.max(0, Math.min(1, x)); }

    // ---- Cost estimation (keep in sync with lib/index.js) ----
    // 内置官方定价（人民币，每百万 tokens），高峰价 + 空闲半价（折成显式 offpeak）。
    // 键 = provider 路由名 → 模型名。用户可通过 settings.yaml 的 context-vista
    // 命名空间覆盖/新增（经 contextPricing 投影下发到客户端）。
    var DEFAULT_TIMEZONE = 8;
    var DEFAULT_PEAK_WINDOWS = [
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ];
    var BUILTIN_PRICING = {
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
    };
    var BUILTIN_CONFIG = {
      timezone: DEFAULT_TIMEZONE,
      peakWindows: DEFAULT_PEAK_WINDOWS,
      pricing: BUILTIN_PRICING,
      routes: { 'deepseek-official': 'https://api.deepseek.com' },
    };

    function entryForKey(pricing, key, model) {
      var byKey = pricing ? pricing[key] : undefined;
      if (byKey) {
        if (byKey[model] != null) return byKey[model];
        if (byKey['*'] != null) return byKey['*'];
      }
      return undefined;
    }

    function periodPrice(entry, peak) {
      if (!entry) return undefined;
      var hasSplit = entry.peak != null || entry.offpeak != null;
      if (hasSplit) {
        var want = peak ? entry.peak : entry.offpeak;
        var other = peak ? entry.offpeak : entry.peak;
        return want != null ? want : other;
      }
      return { hit: entry.hit ?? 0, miss: entry.miss ?? 0, output: entry.output ?? 0 };
    }

    function resolvePrice(pricing, routes, provider, model, peak) {
      var keys = [];
      if (routes && provider && routes[provider]) keys.push(routes[provider]);
      if (provider) keys.push(provider);
      keys.push('*');
      for (var i = 0; i < keys.length; i++) {
        var got = periodPrice(entryForKey(pricing, keys[i], model), peak);
        if (got) return got;
      }
      var modelKey = String(model || '').toLowerCase();
      var fallbackModel = modelKey.indexOf('flash') >= 0 ? 'deepseek-v4-flash' : 'deepseek-v4-pro';
      return periodPrice(entryForKey(BUILTIN_PRICING, 'deepseek-official', fallbackModel), peak);
    }

    function minutesOfDay(str) {
      var match = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
      if (!match) return undefined;
      return Number(match[1]) * 60 + Number(match[2]);
    }

    function isPeak(now, timezone, peakWindows) {
      var offset = typeof timezone === 'number' ? timezone : DEFAULT_TIMEZONE;
      var windows = Array.isArray(peakWindows) && peakWindows.length > 0 ? peakWindows : DEFAULT_PEAK_WINDOWS;
      var utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      var local = new Date(utcMs + offset * 3600000);
      var minutes = local.getHours() * 60 + local.getMinutes();
      for (var i = 0; i < windows.length; i++) {
        var start = minutesOfDay(windows[i] && windows[i].start);
        var end = minutesOfDay(windows[i] && windows[i].end);
        if (start == null || end == null) continue;
        if (end > start) {
          if (minutes >= start && minutes < end) return true;
        } else {
          if (minutes >= start || minutes < end) return true; // 跨午夜窗口
        }
      }
      return false;
    }

    function estimateCost(usage, price) {
      if (!usage || !price) return undefined;
      return (
        ((usage.uncachedInputTokens || 0) * (price.miss || 0) +
          ((usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)) * (price.hit || 0) +
          (usage.outputTokens || 0) * (price.output || 0)
        ) / 1000000
      );
    }

    function fmtCost(value) {
      if (!isNum(value)) return '–';
      if (value >= 1) return '¥' + value.toFixed(2);
      if (value >= 0.01) return '¥' + value.toFixed(4);
      return '¥' + value.toFixed(6);
    }

    // Latest finalized assistant's route (provider + model) from the conversation snapshot.
    function currentRoute(snapshot) {
      if (!snapshot || !snapshot.nodes) return undefined;
      for (var i = snapshot.nodes.length - 1; i >= 0; i--) {
        var node = snapshot.nodes[i];
        if (!node || node.kind !== 'assistant') continue;
        if (node.provenance && node.provenance.model) return node.provenance;
        if (node.requestConfig && node.requestConfig.model) return node.requestConfig;
      }
      return undefined;
    }

    // Latest compaction summary (the /compact checkpoint) from the snapshot.
    function latestCompaction(snapshot) {
      if (!snapshot || !snapshot.nodes) return undefined;
      for (var i = snapshot.nodes.length - 1; i >= 0; i--) {
        var node = snapshot.nodes[i];
        if (node && node.kind === 'compaction') return node;
      }
      return undefined;
    }

    var TAU = 2 * Math.PI;

    function pt(cx, cy, r, a) { return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }

    // Donut segment path. Angles are radians with 0 = 12 o'clock, clockwise.
    // A full-circle slice becomes two concentric circles (evenodd makes the hole).
    function segPath(cx, cy, rO, rI, a0, a1) {
      if (a1 - a0 >= TAU - 1e-6) {
        return [
          'M', cx - rO, cy, 'A', rO, rO, 0, 1, 0, cx + rO, cy, 'A', rO, rO, 0, 1, 0, cx - rO, cy, 'Z',
          'M', cx - rI, cy, 'A', rI, rI, 0, 1, 0, cx + rI, cy, 'A', rI, rI, 0, 1, 0, cx - rI, cy, 'Z'
        ].join(' ');
      }
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      var p0 = pt(cx, cy, rO, a0);
      var p1 = pt(cx, cy, rO, a1);
      var p2 = pt(cx, cy, rI, a1);
      var p3 = pt(cx, cy, rI, a0);
      return [
        'M', p0[0].toFixed(3), p0[1].toFixed(3),
        'A', rO, rO, 0, large, 1, p1[0].toFixed(3), p1[1].toFixed(3),
        'L', p2[0].toFixed(3), p2[1].toFixed(3),
        'A', rI, rI, 0, large, 0, p3[0].toFixed(3), p3[1].toFixed(3),
        'Z'
      ].join(' ');
    }

    var PALETTE = ['#8b5cf6', '#f59e0b', '#10b981'];
    // Neutral fill for the unused remainder of the context window.
    var FREE_COLOR = 'var(--dsw-alias-border-l2)';
    // Slate fill for the "compacted away" conversation slice.
    var COMPACTED_COLOR = '#64748b';

    function Donut(props) {
      // The whole ring equals `props.total` (the context window) when given;
      // otherwise it falls back to the sum of the slices (composition only).
      var total = props.total > 0 ? props.total : 0;
      if (total <= 0) {
        for (var i = 0; i < props.slices.length; i++) total += props.slices[i].value;
      }
      var cx = 60, cy = 60, rO = 52, rI = 34;
      var parts = [];
      if (total > 0) {
        var a = 0;
        var remaining = total;
        for (var j = 0; j < props.slices.length; j++) {
          var take = Math.min(Math.max(0, props.slices[j].value), remaining);
          if (take <= 0) continue;
          var a1 = a + (take / total) * TAU;
          parts.push(React.createElement('path', {
            key: 's' + j,
            d: segPath(cx, cy, rO, rI, a, a1),
            fill: props.slices[j].color,
            fillRule: 'evenodd'
          }));
          a = a1;
          remaining -= take;
          if (remaining <= 1e-6) break;
        }
      }
      var centerEl = props.center
        ? React.createElement('text', { x: cx, y: cy, className: 'dcc-donut-center', textAnchor: 'middle', dominantBaseline: 'central' }, String(props.center))
        : null;
      return React.createElement('svg', {
        className: props.className || 'dcc-donut', viewBox: '0 0 120 120', role: 'img', 'aria-label': props.label
      }, parts.concat(centerEl ? [centerEl] : []));
    }

    function legendRow(slice) {
      return React.createElement('div', { key: slice.label, className: 'dcc-legend-row' },
        React.createElement('span', { className: 'dcc-dot', style: { background: slice.color } }),
        React.createElement('span', { className: 'dcc-legend-label' }, slice.label),
        React.createElement('span', { className: 'dcc-legend-value' }, compact(slice.value))
      );
    }

    function totalRow(label, value) {
      return React.createElement('div', { className: 'dcc-total' },
        React.createElement('span', { className: 'dcc-total-label' }, label),
        React.createElement('span', { className: 'dcc-total-value' }, compact(value))
      );
    }

    // The component registered into `conversation.chat.commandview` under
    // `key: 'context'`: it replaces the generic command card for `/context`.
    // Props: standard session kit (useProjection, sessionId, useSession, …)
    // plus the owner's `node` and the locale seat `t`.
    function ContextCommandView(props) {
      var t = props.t;
      var useProjection = props.useProjection;
      var useSession = props.useSession;
      var pressure = useProjection('contextPressure');
      var breakdown = useProjection('contextBreakdown');
      var usage = useProjection('tokenUsage');
      var pricingProj = useProjection('contextPricing');
      var route = useSession ? useSession(currentRoute) : undefined;
      var provider = route && route.provider;
      var model = route && route.model;
      var cfg = pricingProj && (pricingProj.timezone !== undefined || pricingProj.pricing) ? pricingProj : BUILTIN_CONFIG;
      var now = new Date();
      var peakNow = isPeak(now, cfg.timezone, cfg.peakWindows);
      var price = resolvePrice(cfg.pricing, cfg.routes, provider, model, peakNow);
      var cost = estimateCost(usage, price);
      var compaction = useSession ? useSession(latestCompaction) : undefined;
      var shadowed = compaction && isNum(compaction.shadowedTokenCount) ? compaction.shadowedTokenCount : 0;
      var hasCompaction = compaction != null && shadowed > 0;

      var windowT = pressure && isNum(pressure.contextWindow) ? pressure.contextWindow : undefined;
      var projected = pressure && isNum(pressure.projectedTokens) ? pressure.projectedTokens : undefined;
      var lastRequest = pressure && isNum(pressure.pressureTokens) ? pressure.pressureTokens : undefined;

      var system = breakdown && isNum(breakdown.systemTokens) ? breakdown.systemTokens : 0;
      var tools = breakdown && isNum(breakdown.toolsTokens) ? breakdown.toolsTokens : 0;
      var messages = breakdown && isNum(breakdown.messageTokens) ? breakdown.messageTokens : 0;
      var used = system + tools + messages;
      var hasCapacity = isNum(windowT) && windowT > 0;
      var slices;
      var ringTotal;
      if (hasCapacity) {
        slices = [
          { label: t('system'), value: system, color: PALETTE[0] },
          { label: t('tools'), value: tools, color: PALETTE[1] },
          { label: t('messages'), value: messages, color: PALETTE[2] },
          { label: t('free'), value: Math.max(0, windowT - used), color: FREE_COLOR },
        ];
        ringTotal = windowT;
      } else {
        slices = [
          { label: t('system'), value: system, color: PALETTE[0] },
          { label: t('tools'), value: tools, color: PALETTE[1] },
          { label: t('messages'), value: messages, color: PALETTE[2] },
        ];
        ringTotal = used;
      }

      var occupancy = null;
      if (isNum(projected) && isNum(windowT)) occupancy = clamp01(projected / windowT);
      else if (isNum(lastRequest) && isNum(windowT)) occupancy = clamp01(lastRequest / windowT);

      var children = [];

      children.push(React.createElement('div', { key: 'header', className: 'dcc-header' },
        React.createElement('span', { className: 'dcc-title' }, t('title')),
        React.createElement('span', { className: 'dcc-window' }, t('window') + ': ' + fmt(windowT) + ' tokens')
      ));

      children.push(React.createElement('div', { key: 'body', className: 'dcc-body' },
        React.createElement(Donut, { slices: slices, total: ringTotal, label: t('composition') }),
        React.createElement('div', { className: 'dcc-legend' }, slices.map(legendRow))
      ));

      if (hasCompaction) {
        var compactSlices = [
          { label: t('compacted'), value: shadowed, color: COMPACTED_COLOR },
          { label: t('liveConv'), value: messages, color: PALETTE[2] },
        ];
        children.push(React.createElement('div', { key: 'compaction' },
          React.createElement('div', { className: 'dcc-section-label' }, t('compaction')),
          React.createElement('div', { className: 'dcc-body' },
            React.createElement(Donut, { slices: compactSlices, total: shadowed + messages, label: t('compaction') }),
            React.createElement('div', { className: 'dcc-legend' }, compactSlices.map(legendRow))
          )
        ));
      }

      if (occupancy !== null) {
        children.push(React.createElement('div', { key: 'bar' },
          React.createElement('div', { className: 'dcc-section-label' }, t('projected')),
          React.createElement('div', { className: 'dcc-bar-track' },
            React.createElement('div', { className: 'dcc-bar-fill', style: { width: (occupancy * 100).toFixed(1) + '%' } })
          ),
          React.createElement('div', { className: 'dcc-bar-row' },
            React.createElement('span', { className: 'dcc-bar-nums' }, compact(projected) + ' / ' + fmt(windowT) + ' tokens'),
            React.createElement('span', { className: 'dcc-bar-pct' }, (occupancy * 100).toFixed(1) + '%')
          )
        ));
      } else if (isNum(lastRequest)) {
        children.push(React.createElement('div', { key: 'last', className: 'dcc-total' },
          React.createElement('span', { className: 'dcc-total-label' }, t('lastRequest')),
          React.createElement('span', { className: 'dcc-total-value' }, compact(lastRequest) + ' tokens')
        ));
      }

      if (usage) {
        children.push(React.createElement('div', { key: 'totals' },
          React.createElement('div', { className: 'dcc-section-label' }, t('sessionTotals')),
          React.createElement('div', { className: 'dcc-totals' },
            totalRow(t('input'), usage.uncachedInputTokens),
            totalRow(t('output'), usage.outputTokens),
            totalRow(t('cacheRead'), usage.cacheReadTokens),
            totalRow(t('cacheWrite'), usage.cacheWriteTokens)
          ),
          cost !== undefined ? React.createElement('div', { className: 'dcc-cost' },
            React.createElement('span', { className: 'dcc-cost-label' }, t('cost')),
            React.createElement('span', { className: 'dcc-cost-value' }, fmtCost(cost))
          ) : null,
          cost !== undefined ? React.createElement('div', { className: 'dcc-cost-note' },
            t('estimateNote') + ' · ' + (model || 'default') + (provider ? ' @ ' + provider : '') + ' · ' + (peakNow ? t('peak') : t('offpeak'))
          ) : null
        ));
      }

      if (system + tools + messages === 0 && !isNum(projected) && !isNum(lastRequest) && !usage) {
        children.push(React.createElement('div', { key: 'empty', className: 'dcc-empty' }, t('noData')));
      }

      return React.createElement('div', { className: 'dcc-card' }, children);
    }

    // ---- Persistent right-side HUD (shell.overlay) ----
    // The right `details` column is a single-occupant slot reserved for tool
    // details and only opens on a tool-row click, so a persistent donut lives
    // in the additive frame-wide overlay layer instead. That layer is
    // root-scoped (no `useProjection`), so we subscribe to the current
    // session's projection faces through the public ctx.sessions surface.
    var SESSIONS = null; // set in apply(ctx)

    function useHudData(currentId) {
      var state = React.useState(null);
      var setData = state[1];
      React.useEffect(function () {
        if (!currentId || !SESSIONS) { setData(null); return; }
        var binding = SESSIONS.binding(currentId);
        var session = binding && binding.session;
        if (!session || !session.projections || typeof session.subscribe !== 'function') { setData(null); return; }
        function read() {
          setData({
            pressure: session.projections.faceOf('contextPressure').getSnapshot(),
            breakdown: session.projections.faceOf('contextBreakdown').getSnapshot(),
            usage: session.projections.faceOf('tokenUsage').getSnapshot(),
            pricing: session.projections.faceOf('contextPricing').getSnapshot(),
            snapshot: session.getSnapshot(),
          });
        }
        read();
        var off = [];
        off.push(session.subscribe(read));
        off.push(session.projections.faceOf('contextPressure').subscribe(read));
        off.push(session.projections.faceOf('contextBreakdown').subscribe(read));
        off.push(session.projections.faceOf('tokenUsage').subscribe(read));
        off.push(session.projections.faceOf('contextPricing').subscribe(read));
        return function () { for (var i = 0; i < off.length; i++) off[i](); };
      }, [currentId]);
      return state[0];
    }

    var HUD_TOP_KEY = 'context-vista.hudTop';

    function loadTop() {
      if (typeof window === 'undefined') return null;
      try {
        var raw = window.localStorage.getItem(HUD_TOP_KEY);
        if (raw == null) return null;
        var n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : null;
      } catch (e) { return null; }
    }

    function saveTop(v) {
      if (typeof window === 'undefined') return;
      try { window.localStorage.setItem(HUD_TOP_KEY, String(v)); } catch (e) {}
    }

    function ContextHud(props) {
      var t = props.t;
      var useSessions = props.useSessions;
      if (typeof useSessions !== 'function') return null;
      var currentId = useSessions(function (s) { return s && s.current; });
      var data = useHudData(currentId);
      var expState = React.useState(true);
      var expanded = expState[0];
      var setExpanded = expState[1];

      // Vertical position: remembered in localStorage; null = CSS-centered default.
      var cardRef = React.useRef(null);
      var topState = React.useState(loadTop);
      var top = topState[0];
      var setTop = topState[1];
      var dragRef = React.useRef(null);
      var dragState = React.useState(false);
      var dragging = dragState[0];
      var setDragging = dragState[1];

      if (!data) return null;

      var pressure = data.pressure;
      var breakdown = data.breakdown;
      var usage = data.usage;
      var pricingProj = data.pricing;
      var route = currentRoute(data.snapshot);
      var provider = route && route.provider;
      var model = route && route.model;
      var cfg = pricingProj && (pricingProj.timezone !== undefined || pricingProj.pricing) ? pricingProj : BUILTIN_CONFIG;
      var now = new Date();
      var peakNow = isPeak(now, cfg.timezone, cfg.peakWindows);
      var price = resolvePrice(cfg.pricing, cfg.routes, provider, model, peakNow);
      var cost = estimateCost(usage, price);

      var windowT = pressure && isNum(pressure.contextWindow) ? pressure.contextWindow : undefined;
      var projected = pressure && isNum(pressure.projectedTokens) ? pressure.projectedTokens : undefined;
      var lastRequest = pressure && isNum(pressure.pressureTokens) ? pressure.pressureTokens : undefined;

      var system = breakdown && isNum(breakdown.systemTokens) ? breakdown.systemTokens : 0;
      var tools = breakdown && isNum(breakdown.toolsTokens) ? breakdown.toolsTokens : 0;
      var messages = breakdown && isNum(breakdown.messageTokens) ? breakdown.messageTokens : 0;
      var used = system + tools + messages;
      var hasCapacity = isNum(windowT) && windowT > 0;

      if (used === 0 && !isNum(projected) && !isNum(lastRequest) && !usage) return null;

      var slices;
      var ringTotal;
      if (hasCapacity) {
        slices = [
          { label: t('system'), value: system, color: PALETTE[0] },
          { label: t('tools'), value: tools, color: PALETTE[1] },
          { label: t('messages'), value: messages, color: PALETTE[2] },
          { label: t('free'), value: Math.max(0, windowT - used), color: FREE_COLOR },
        ];
        ringTotal = windowT;
      } else {
        slices = [
          { label: t('system'), value: system, color: PALETTE[0] },
          { label: t('tools'), value: tools, color: PALETTE[1] },
          { label: t('messages'), value: messages, color: PALETTE[2] },
        ];
        ringTotal = used;
      }

      var occupancy = null;
      if (isNum(projected) && isNum(windowT)) occupancy = clamp01(projected / windowT);
      else if (isNum(lastRequest) && isNum(windowT)) occupancy = clamp01(lastRequest / windowT);

      // ---- drag to move vertically ----
      function clampTop(v) {
        var el = cardRef.current;
        var parent = el && el.offsetParent;
        var cardH = el ? el.offsetHeight : 0;
        var frameH = parent ? parent.offsetHeight : (typeof window !== 'undefined' ? window.innerHeight : 0);
        var max = Math.max(8, frameH - cardH - 8);
        return Math.max(8, Math.min(max, v));
      }

      function onPointerDown(e) {
        if (e.button != null && e.button !== 0) return;
        var target = e.target;
        if (target && target.closest && target.closest('.dcc-hud-toggle')) return; // let the collapse button click through
        var el = cardRef.current;
        if (!el) return;
        var parent = el.offsetParent;
        var elRect = el.getBoundingClientRect();
        var parentRect = parent ? parent.getBoundingClientRect() : { top: 0 };
        dragRef.current = { startTop: elRect.top - parentRect.top, startY: e.clientY, lastTop: null };
        setDragging(true);
        var head = e.currentTarget;
        if (head && head.setPointerCapture) { try { head.setPointerCapture(e.pointerId); } catch (err) {} }
        e.preventDefault();
      }

      function onPointerMove(e) {
        if (!dragRef.current) return;
        var dy = e.clientY - dragRef.current.startY;
        var next = clampTop(dragRef.current.startTop + dy);
        dragRef.current.lastTop = next;
        setTop(next);
      }

      function onPointerEnd() {
        if (!dragRef.current) return;
        var lastTop = dragRef.current.lastTop;
        dragRef.current = null;
        setDragging(false);
        if (lastTop != null) saveTop(lastTop);
      }

      var toggle = function () { setExpanded(!expanded); };
      var hudStyle = { pointerEvents: 'auto', top: top != null ? top + 'px' : '50%', transform: top != null ? 'none' : 'translateY(-50%)' };
      var hudClass = 'dcc-hud' + (expanded ? '' : ' dcc-hud-collapsed') + (dragging ? ' dcc-hud-dragging' : '');

      var header = React.createElement('div', {
        className: 'dcc-hud-head',
        onPointerDown: onPointerDown,
        onPointerMove: onPointerMove,
        onPointerUp: onPointerEnd,
        onPointerCancel: onPointerEnd
      },
        React.createElement('span', { className: 'dcc-hud-title' }, t('title')),
        React.createElement('button', { type: 'button', className: 'dcc-hud-toggle', 'aria-label': expanded ? t('collapse') : t('expand'), title: expanded ? t('collapse') : t('expand'), onClick: toggle }, expanded ? '▸' : '◂')
      );

      var body = [];
      if (expanded) {
        body.push(React.createElement(Donut, { className: 'dcc-hud-donut', slices: slices, total: ringTotal, center: occupancy != null ? (occupancy * 100).toFixed(0) + '%' : null, label: t('composition') }));
        body.push(React.createElement('div', { className: 'dcc-legend' }, slices.map(legendRow)));
        body.push(React.createElement('div', { className: 'dcc-hud-foot' },
          React.createElement('div', { className: 'dcc-hud-row' },
            React.createElement('span', { className: 'dcc-hud-row-l' }, t('projected')),
            React.createElement('span', { className: 'dcc-hud-row-v' }, compact(projected) + ' / ' + fmt(windowT) + ' tokens')
          ),
          cost !== undefined ? React.createElement('div', { className: 'dcc-hud-row' },
            React.createElement('span', { className: 'dcc-hud-row-l' }, t('cost')),
            React.createElement('span', { className: 'dcc-hud-row-v dcc-hud-cost' }, fmtCost(cost))
          ) : null,
          cost !== undefined ? React.createElement('div', { className: 'dcc-hud-note' },
            (model || 'default') + (provider ? ' @ ' + provider : '') + ' · ' + (peakNow ? t('peak') : t('offpeak'))
          ) : null
        ));
      }

      return React.createElement('div', { ref: cardRef, className: hudClass, style: hudStyle }, [header].concat(body));
    }

    function apply(ctx) {
      SESSIONS = ctx.sessions;

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'context-vista: locale');

      // The controller belongs to the caller's fiber, so the wait and the
      // contribution are both removed automatically on plugin unload.
      ctx.slots.inject('conversation.chat.commandview', function () {
        return ctx.slots.register(
          { name: 'conversation.chat.commandview', key: 'context', locale: NS },
          ContextCommandView
        );
      });

      // Persistent, always-on donut pinned to the right side of the frame.
      // shell.overlay is the additive frame-wide floating layer; the donut
      // updates live off the same host projections the /context card reads.
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          { name: 'shell.overlay', id: 'context-hud', order: 100, locale: NS },
          ContextHud
        );
      });
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
