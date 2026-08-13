// Client half of dsh-command-context: upgrades the durable `/context` command
// row into a card with an SVG donut chart (context composition) plus an
// occupancy bar and cumulative session totals. Plain JavaScript — no bundler.
//
// Data comes from the host-computed session projections, read through the
// framework's `useProjection` seat (no custom Host RPC required):
//   - contextBreakdown -> system / tools / messages heuristic composition
//   - contextPressure  -> projectedTokens / pressureTokens / contextWindow
//   - tokenUsage       -> cumulative provider buckets for the whole log
window.__ModuleLoader__.load({
  id: 'dsh-command-context',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    var NS = 'dsh-context';
    var inject = ['slots', 'locale'];

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
      '.dcc-cost-note{font-size:11px;color:var(--dsw-alias-label-caption);line-height:16px;margin-top:2px}'
    ].join('\n');

    var tagId = 'dsh-command-context/context.css';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      var styleTag = document.createElement('style');
      styleTag.dataset.plugin = 'dsh-command-context';
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
    // DeepSeek 官方开放平台定价（人民币，每百万 tokens），高峰价：
    //   flash: 缓存命中 0.1 / 未命中 3 / 输出 9
    //   pro:   缓存命中 0.3 / 未命中 9 / 输出 27
    // 峰谷时段（北京时间 UTC+8）：高峰 9:00–12:00、14:00–18:00，其余空闲半价。
    var PRICING = {
      'deepseek-v4-pro': { miss: 9.0, hit: 0.3, output: 27.0 },
      'deepseek-v4-flash': { miss: 3.0, hit: 0.1, output: 9.0 },
    };
    var DEFAULT_PRICE = PRICING['deepseek-v4-pro'];

    function priceFor(model) {
      var key = String(model || '').toLowerCase();
      if (key.indexOf('flash') >= 0) return PRICING['deepseek-v4-flash'];
      return PRICING['deepseek-v4-pro']; // pro / reasoner / chat / unknown → pro
    }

    // 北京时间是否处于高峰时段。
    function isPeakBeijing(now) {
      var bjMinutes = ((now.getUTCHours() + 8) % 24) * 60 + now.getUTCMinutes();
      return (bjMinutes >= 540 && bjMinutes < 720) || (bjMinutes >= 840 && bjMinutes < 1080);
    }

    function periodMultiplier(now) {
      return isPeakBeijing(now) ? 1.0 : 0.5;
    }

    function estimateCost(usage, price, multiplier) {
      if (!usage || !price) return undefined;
      var base = (
        (usage.uncachedInputTokens || 0) * price.miss +
        ((usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)) * price.hit +
        (usage.outputTokens || 0) * price.output
      ) / 1000000;
      return base * (multiplier || 1);
    }

    function fmtCost(value) {
      if (!isNum(value)) return '–';
      if (value >= 1) return '¥' + value.toFixed(2);
      if (value >= 0.01) return '¥' + value.toFixed(4);
      return '¥' + value.toFixed(6);
    }

    // Latest finalized assistant's model from the conversation snapshot.
    function currentModel(snapshot) {
      if (!snapshot || !snapshot.nodes) return undefined;
      for (var i = snapshot.nodes.length - 1; i >= 0; i--) {
        var node = snapshot.nodes[i];
        if (node && node.kind === 'assistant' && node.provenance && node.provenance.model) {
          return node.provenance.model;
        }
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
      return React.createElement('svg', {
        className: 'dcc-donut', viewBox: '0 0 120 120', role: 'img', 'aria-label': props.label
      }, parts);
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
      var model = useSession ? useSession(currentModel) : undefined;
      var now = new Date();
      var peakNow = isPeakBeijing(now);
      var cost = estimateCost(usage, priceFor(model), periodMultiplier(now));
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
            t('estimateNote') + ' · ' + (model || 'default') + ' · ' + (peakNow ? t('peak') : t('offpeak'))
          ) : null
        ));
      }

      if (system + tools + messages === 0 && !isNum(projected) && !isNum(lastRequest) && !usage) {
        children.push(React.createElement('div', { key: 'empty', className: 'dcc-empty' }, t('noData')));
      }

      return React.createElement('div', { className: 'dcc-card' }, children);
    }

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'dsh-command-context: locale');

      // The controller belongs to the caller's fiber, so the wait and the
      // contribution are both removed automatically on plugin unload.
      ctx.slots.inject('conversation.chat.commandview', function () {
        return ctx.slots.register(
          { name: 'conversation.chat.commandview', key: 'context', locale: NS },
          ContextCommandView
        );
      });
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
