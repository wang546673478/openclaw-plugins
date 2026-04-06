# OpenClaw 插件开发机会文档

> 整理自源码分析 + 进化清单对照
> 日期：2026-04-06

---

## 一、OpenClaw 架构核心特征

### 1.1 多通道 Gateway vs 单 CLI

OpenClaw 是**多通道 AI Gateway**，Claude Code 是单 CLI harness。

```
飞书/Discord/Telegram/WhatsApp
        ↓
   Gateway Router
        ↓
  Agent Dispatcher ← Binding 路由
        ↓
  Agent Loop (Pi-agent-core)
        ↓
  Plugin Registry ← Hooks/Tools/Channels/Providers
```

**关键差异：** OpenClaw 有 Channel 层，所以 MCP Channels / KAIROS 的外部事件推入在 OpenClaw 是**通道机制**问题，不是单 CLI 问题。

### 1.2 Plugin 是能力所有权边界

| 原则 | 说明 |
|------|------|
| 一个 Plugin = 一个公司或一个功能 | 不做功能杂烩 |
| Capability 合同 | core 定义合同，vendor 插件实现 |
| 通道/功能插件 = 能力消费者 | 不自己实现 provider 行为 |
| SKILL.md = harness 层 workaround | Plugin 是真实拦截，SKILL.md 是 AI 自觉 |

### 1.3 三种 Plugin 形状

| 形状 | 说明 | 我们的 6 个 |
|------|------|-------------|
| plain-capability | 注册一种能力 | ❌ |
| hybrid-capability | 注册多种能力 | ❌ |
| hook-only | 只注册 hooks/tools/services | ✅ 全部是 |

---

## 二、我们的 Plugin 现状分析

### 2.1 现有 Plugin 一览

| Plugin | Hooks 数 | 代码行 | 实现质量 |
|--------|----------|--------|---------|
| agent-hooks | 7 | ~80 | ⚠️ 中等 |
| analytics | 2 | ~100 | ⚠️ 中等 |
| session-save | 1 | ~80 | ❌ 差 |
| subagent-aggregate | 2 | ~80 | ⚠️ 中等 |
| code-change | 2 | ~120 | ⚠️ 中等 |
| scheduled-tasks | 2 | ~150 | ⚠️ 中等 |

### 2.2 质量问题汇总

**session-save：**
- 决策提取逻辑是空的（`decisions: []`）
- 30秒阈值过滤了太多短 session
- 没有真正实现 ExtractMemories

**code-change：**
- 只检测 git 操作，没有后续验证
- 没有和 CI 系统集成
- 不算真正的 VERIFICATION_AGENT

**agent-hooks：**
- 20条消息阈值硬编码
- 没有 before_compaction 实现
- 长对话提醒依赖 AI 自觉

**analytics：**
- 没有使用 api.runtime subagent
- 没有 GrowthBook/Datadog 集成
- 只是简单的 in-memory 统计

---

## 三、Plugin 机会矩阵

### 3.1 可通过 Plugin 弥补的进化任务

| 任务 | 机会 | 难度 | ROI |
|------|------|------|-----|
| BriefTool (P0) | `agent_end` hook 生成 1-3 句摘要 | 低 | 高 |
| Away Summary (P4) | `session_end` hook 检测用户离开 | 低 | 高 |
| Micro Compact (P0) | `before_compaction` hook 实现轻度压缩 | 中 | 高 |
| Compact Warning (P0) | `before_compaction` hook 注入警告 | 低 | 高 |
| Hooks 扩展 (P2) | 注册更多 hook 类型 | 中 | 中 |
| Memory 类型 (P2) | frontmatter 约定 + plugin 辅助 | 低 | 中 |

### 3.2 需要研究源码的架构机会

| 任务 | 研究路径 | 难度 | 价值 |
|------|---------|------|------|
| MCP Channels / KAIROS | 读飞书 channel 源码，理解 Gateway 通道机制 | 高 | 极高 |
| Coordinator Mode | 读 sessions_spawn/sessions_send 源码 | 高 | 高 |
| RemoteSessionManager | 读 ACP remote bridge 源码 | 中 | 中 |

### 3.3 Plugin 难以弥补的架构差距

| 任务 | 原因 |
|------|------|
| Fork-Join Cache | sessions 完全独立，无 KV 共享机制 |
| MCP OAuth | Gateway auth 层硬编码 |
| `PreCommand/PostCommand` hooks | hook 类型不存在 |
| `Wake/Idle` hooks | hook 类型不存在 |

---

## 四、最值得优先开发的 3 个 Plugin

### 4.1 brief-tool — 主动摘要（补 P0）

**定位：** 用户离开时生成 1-3 句进度摘要，比完整 compaction 轻量

**实现：**
```typescript
api.on("agent_end", async (event) => {
  // 提取最后几条 user/assistant 消息
  // 生成 1-3 句摘要
  // 写入 memory/brief/YYYY-MM-DD.md
})
```

**差异化价值：** Claude Code 有 BriefTool，OpenClaw 没有

---

### 4.2 compact-warning — 上下文警告（补 P0）

**定位：** 在上下文接近满时提前警告，而不是等 compaction 发生

**实现：**
```typescript
api.on("before_compaction", async (event) => {
  // 检测上下文 token 数
  // 如果接近阈值，注入警告到 prependContext
  // 可触发 microCompact（轻度压缩）
})
```

**差异化价值：** 填补 OpenClaw 没有 `compactWarningHook` 的差距

---

### 4.3 away-summary — 离开摘要（补 P4）

**定位：** 用户离开后回来，显示 1-3 句会话摘要

**实现：**
```typescript
api.on("session_end", async (event) => {
  // 检测 session 持续时间
  // 如果 > N 分钟，生成离开摘要
  // 写入 memory/away/YYYY-MM-DD.md
  // 下次 session_start 时 prependContext 注入
})
```

**差异化价值：** Claude Code 有 awaySummary，OpenClaw 没有

---

## 五、MCP Channels / KAIROS 研究路线图

### 5.1 为什么重要

KAIROS 的 Channels 机制是 Claude Code 泄露最大亮点：
- 外部事件（Telegram/Discord/webhooks）推入运行中的 Claude Code
- 通过 MCP server 实现双向通信
- 相当于"外部事件触发 AI 响应"

### 5.2 OpenClaw 的对等机制

OpenClaw 有 Gateway + Channel 架构，**可能对等物：**

| Claude Code KAIROS | OpenClaw 等价 |
|-------------------|--------------|
| 外部事件 → Claude Code | Gateway Route Handler → Agent |
| MCP server | `registerHttpRoute` plugin |
| Channel 事件注入 | Feishu/Discord channel 消息 |

### 5.3 研究步骤

1. **读懂飞书 channel 实现**
   - `docs/channels/feishu.md`
   - `docs/channels/channel-routing.md`
   - `docs/plugins/sdk-channel-plugins.md`

2. **理解 Gateway 如何接收外部事件**
   - HTTP webhook（`registerHttpRoute`）
   - Channel 轮询
   - Long polling / WebSocket

3. **找到注入点**
   - `message_received` hook
   - `api.sendMessage` runtime helper
   - subagent session 注入

4. **原型验证**
   - 写一个简单的 HTTP route plugin
   - 看能否向运行中的 agent 注入消息

---

## 六、Plugin SDK 关键 API 备忘

### 6.1 注册方法

```typescript
api.registerHook(events, handler, opts?)   // 事件钩子
api.registerTool(tool, opts?)              // 工具注册
api.registerCommand(def)                   // 命令注册
api.registerHttpRoute(params)              // HTTP 路由
api.registerService(service)              // 后台服务
api.registerGatewayMethod(name, handler)  // Gateway RPC
```

### 6.2 Runtime Helpers

```typescript
api.runtime.subagent.run({ sessionKey, message })  // 启动 subagent
api.runtime.tts.textToSpeech({ text, cfg })       // TTS
api.runtime.webSearch.search({ config, args })     // 搜索
api.runtime.mediaUnderstanding.describeImageFile() // 图片理解
```

### 6.3 Hook 决策规则

| Hook | 返回 `{ block: true }` | 效果 |
|------|----------------------|------|
| `before_tool_call` | block = terminal | 停止执行 |
| `before_install` | block = terminal | 停止安装 |
| `message_sending` | cancel = terminal | 取消发送 |

---

## 七、行动清单

### 立即可做（1-2 小时）

- [ ] brief-tool plugin — 生成离开摘要
- [ ] away-summary plugin — 离开时写 memory/away/
- [ ] compact-warning plugin — 上下文警告

### 本周可做（1-2 天）

- [ ] 研究飞书 channel 源码
- [ ] 实现 HTTP route plugin 原型
- [ ] 验证外部事件能否注入 agent session

### 长期研究（需要源码深入）

- [ ] MCP Channels / KAIROS 机制
- [ ] Coordinator Mode 实现
- [ ] Fork-Join Cache 架构可行性
