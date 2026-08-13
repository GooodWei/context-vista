<div align="center">

<img src="pic.png" alt="COLLEAGUE.SKILL — Distill how they think." width="100%">

<br>
</div>

# dsh-command-context

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 `/context` 斜杠命令，用**环形图**展示当前上下文 token 用量与分配，对标 Claude Code 的 `/context`。

- **Host 半部**：注册 `/context` 命令，返回文本摘要（headless / 非 Web 界面可用）。
- **Client 半部**：把 Web 端 `/context` 的命令行升级成一张卡片，包含：
  - **上下文组成环形图**：系统提示词 / 工具 schema / 消息，外加灰色"剩余"（未使用）部分，整环 = 上下文窗口。
  - **压缩效果环形图**：执行过 `/compact` 后，显示最近一次压缩释放了多少、保留了多少。
  - **占用进度条**：预计下一次请求占用 vs 上下文窗口，带百分比。
  - **会话累计 + 估算费用**：输入 / 输出 / 缓存读 / 缓存写，以及按 DeepSeek 官方定价估算的费用。

> 环形图是**手写的 SVG**，不依赖任何第三方图表库。

## 安装

需要 pnpm（`dsh plugin` 会把参数转发给 profile 目录里的 pnpm）。

```sh
# 从本地目录
dsh plugin --profile web add file:../dsh-command-context

# 或从 Git 仓库
dsh plugin --profile web add github:<owner>/dsh-command-context

# 重启
dsh web
```

> 从 Git 安装若失败（pnpm 拦截 `prepare` 脚本），把 pnpm 提示的 key 加到 profile 目录 `pnpm-workspace.yaml` 的 `allowBuilds` 里再重试。

## 使用

装好后在输入框输入 `/context` 回车即可。

## 数据来源与语义

客户端不做任何计算，直接读 host 已算好并推送的 session projection（`useProjection`）：

| 展示项 | projection key | 语义 |
|---|---|---|
| 组成环形图 | `contextBreakdown` | 系统 / 工具 / 消息，固定启发式（4 字符 ≈ 1 token）的**估算值** |
| 占用进度条 | `contextPressure` | `projectedTokens` ÷ `contextWindow` |
| 会话累计 | `tokenUsage` | provider **精确**累计：输入 / 输出 / 缓存读 / 缓存写 |
| 估算费用 | 同上 + 当前模型 | 上述 bucket × DeepSeek 官方单价（¥/百万 tokens），**估算** |

这些是 DSH 默认 profile 已挂载的能力（`dsh-token-meter` + `dsh-session-projection`），本插件无需自建 Host RPC。

### 提醒

- `contextBreakdown` 是启发式估算，会**低估 CJK 文本和 JSON schema**；`tokenUsage` / `contextPressure` 的 provider 部分才是精确值，二者应分开看待。
- 占用率是面向用户的参考数字（非计费、非门控输入），切模型瞬间可能出现短暂错配。

### 费用估算

费用 = `uncachedInputTokens×miss + (cacheReadTokens+cacheWriteTokens)×hit + outputTokens×output`，÷ 1,000,000，再乘时段系数。

- 单价（高峰价，¥/百万 tokens）定义在 `PRICING` 常量里：
  - `deepseek-v4-flash`：缓存命中 0.1 / 未命中 3 / 输出 9
  - `deepseek-v4-pro`：缓存命中 0.3 / 未命中 9 / 输出 27
  - 未匹配到的模型按 pro 档计。
- **峰谷时段（北京时间）**：高峰 9:00–12:00、14:00–18:00（全价）；其余空闲（半价 ×0.5）。
- 因 `tokenUsage` 是累计值、无逐请求时间戳，按**当前时刻**的费率估算整段会话；跨峰谷的会话为近似值。
- 金额仅为**估算**，不是账单。

## License

MIT
