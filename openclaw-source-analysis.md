# OpenClaw 源码分析报告

> 基于 v2026.4.2，本地文档 + 插件源码分析
> 日期：2026-04-06

---

## 目录

1. [架构总览](#1-架构总览)
2. [Agent Loop 生命周期](#2-agent-loop-生命周期)
3. [Plugin 系统深度解析](#3-plugin-系统深度解析)
4. [多 Agent 路由机制](#4-多-agent-路由机制)
5. [Memory 系统](#5-memory-系统)
6. [Compaction 机制](#6-compaction-机制)
7. [现有 Plugin 源码分析](#7-现有-plugin-源码分析)
8. [Hook 类型完整对照表](#8-hook-类型完整对照表)
9. [差距分析与机会](#9-差距分析与机会)

---

## 1. 架构总览

OpenClaw 是一个**多通道 AI Gateway**，核心设计：

```
Channel Plugins (飞书/Discord/Telegram...)
        ↓
   Gateway Router
        ↓
  Agent Dispatcher
        ↓
  Agent Loop (Pi-agent-core)
        ↓
  Plugin Registry ← 注册 hooks/tools/channels/providers
```

**与 Claude Code 的核心差异：**
- Claude Code 是单 CLI harness
- OpenClaw 是多通道 Gateway，可同时接入飞书/Discord/Telegram 等多个消息通道
- 多个 Agent 可以并行运行，每个有自己的 workspace + auth

**关键架构原则：**
- Plugin 不直接修改 core globals，通过 Central Registry 注册
- Capability 所有权模型：公司插件 = 全部表面，通道/功能插件 = 消费核心能力
- 最小导入原则：SDK subpath 而非 monolithic barrel

---

## 2. Agent Loop 生命周期

```
用户消息 → agent RPC → session 解析 → prompt 构建
    → Model 推理 → Tool 执行 → 流式回复 → 持久化
```

**关键 Hook 位置（Plugin 可拦截的点）：**

| Hook | 时机 | 用途 |
|------|------|------|
| `before_model_resolve` | session 开始前 | 修改 provider/model |
| `before_prompt_build` | session 加载后、prompt 发送前 | 注入 prependContext |
| `before_agent_reply` | inline actions 后、LLM 调用前 | 返回合成回复或静默 |
| `agent_end` | 完成后的最终消息列表 | 检查/提取/保存 |
| `before_tool_call` | 工具执行前 | 拦截/审批 |
| `after_tool_call` | 工具执行后 | 日志/计数/副作用 |
| `before_compaction` | 压缩前 | 警告/干预 |
| `after_compaction` | 压缩后 | 验证/记录 |
| `session_start` | session 开始 | 定时任务检查 |
| `session_end` | session 结束 | 离开摘要/会话保存 |

---

## 3. Plugin 系统深度解析

### 3.1 能力模型

OpenClaw 的 plugin 是**能力所有权边界**，不是功能杂烩：

| Capability | 注册方法 | 例子 |
|------------|---------|------|
| Text Inference | `registerProvider` | OpenAI, Anthropic |
| CLI Backend | `registerCliBackend` | OpenAI CLI |
| Channel | `registerChannel` | Feishu, Discord |
| Speech | `registerSpeechProvider` | ElevenLabs |
| Media Understanding | `registerMediaUnderstandingProvider` | OpenAI Vision |
| Image Generation | `registerImageGenerationProvider` | DALL-E |
| Web Search | `registerWebSearchProvider` | Google |

### 3.2 Plugin 形状分类

运行时根据注册行为分类：

- **plain-capability**：只注册一种能力（如 Mistral）
- **hybrid-capability**：注册多种能力（如 OpenAI = text + speech + media + image）
- **hook-only**：只注册 hooks/tools/services，无 capability
- **non-capability**：注册 tools/commands/routes 但无 capability

我们的 6 个 plugin 全部是 **hook-only**。

### 3.3 加载管道

```
发现候选 → 读取 manifest + metadata → 拒绝不安全候选
    → 规范化 plugin config → 决定启用/禁用
    → jiti 加载 native 模块 → 调用 register(api) → 收集注册到 Registry
```

**manifest-first 行为：**
- manifest 是控制平面真相来源
- 可在执行 runtime 前验证 config 和展示 diagnostics
- `activate` 是 `register` 的 legacy 别名

### 3.4 Runtime Helpers

`api.runtime` 提供核心 helper 访问：

```typescript
// TTS
api.runtime.tts.textToSpeech({ text, cfg })
api.runtime.tts.textToSpeechTelephony({ text, cfg })

// Media Understanding
api.runtime.mediaUnderstanding.describeImageFile({ filePath, cfg })
api.runtime.mediaUnderstanding.transcribeAudioFile({ filePath, cfg })

// Subagent
api.runtime.subagent.run({ sessionKey, message, provider, model, deliver })

// Web Search
api.runtime.webSearch.listProviders({ config })
api.runtime.webSearch.search({ config, args })
```

### 3.5 HTTP Routes

Plugin 可通过 `api.registerHttpRoute` 暴露 HTTP 端点：

```typescript
api.registerHttpRoute({
  path: "/my-plugin/webhook",
  auth: "plugin",  // 或 "gateway"
  match: "exact",  // 或 "prefix"
  handler: async (_req, res) => {
    res.statusCode = 200;
    res.end("ok");
    return true;
  }
})
```

---

## 4. 多 Agent 路由机制

OpenClaw 支持**多隔离 Agent**，每个有独立的：

- Workspace（AGENTS.md/SOUL.md/USER.md）
- State directory（auth profiles, model registry）
- Session store

### 4.1 Binding 模型

路由规则：**确定性 + 最具体优先**

1. `peer` 匹配（精确 DM/group/id）
2. `parentPeer` 匹配（thread 继承）
3. `guildId + roles`（Discord 角色路由）
4. `guildId`（Discord）
5. `teamId`（Slack）
6. `accountId` 匹配
7. channel 级别匹配
8. fallback 到默认 agent

### 4.2 Sandbox + Tool 策略

每个 agent 可独立配置 sandbox 和工具限制：

```json5
{
  id: "family",
  sandbox: { mode: "all", scope: "agent" },
  tools: {
    allow: ["exec", "read", "sessions_list"],
    deny: ["write", "edit", "browser", "canvas"]
  }
}
```

---

## 5. Memory 系统

### 5.1 三层 Memory 架构

| 层 | 存储 | 加载方式 |
|----|------|---------|
| **MEMORY.md** | 长期记忆，持久事实/偏好/决策 | 每个 DM session 开始时加载 |
| **memory/YYYY-MM-DD.md** | 每日笔记，运行中上下文 | 今天+昨天的自动加载 |
| **SQLite index** | 向量+关键词混合搜索索引 | `memory_search` 工具触发 |

### 5.2 内存 flush（自动记忆保存）

Compaction 发生**前**，OpenClaw 自动运行一个 silent turn，提醒 agent 将重要上下文保存到 memory 文件。

### 5.3 Backend 选项

| Backend | 特点 |
|---------|------|
| Builtin（默认） | SQLite + FTS5 + 向量搜索，自动检测 embedding provider |
| QMD | Reranking + query expansion，可索引 workspace 外目录 |
| Honcho | 跨 session 记忆 + 用户建模，多 agent 感知 |

---

## 6. Compaction 机制

### 6.1 三层上下文压缩

```
Layer 1: MEMORY.md（200行索引）
Layer 2: topic files（按需加载）
Layer 3: full transcript（可搜索）
```

**关键参数：**
- `AUTOCOMPACT_BUFFER_TOKENS = 13_000`
- `WARNING_THRESHOLD_BUFFER_TOKENS = 20_000`
- `MAX_CONCESSIVE_AUTOCOMPACT_FAILURES = 3`

### 6.2 Compaction vs Pruning

| | Compaction | Pruning |
|--|-----------|---------|
| 做什么 | 将旧对话总结成摘要 | 裁剪旧的工具结果 |
| 保存？ | 是（在 session transcript） | 否（仅内存） |
| 范围 | 整个对话 | 仅工具结果 |

### 6.3 Hook 拦截点

```typescript
api.on("before_compaction", async (event) => { ... })
api.on("after_compaction", async (event) => { ... })
```

---

## 7. 现有 Plugin 源码分析

### 7.1 agent-hooks

**文件：** `plugins/agent-hooks/index.ts`

**注册 Hooks：**
- `before_prompt_build` — 长对话（>20条消息）注入记忆提醒
- `after_tool_call` — 工具调用计数/日志
- `agent_end` — 保存会话摘要
- `session_start` / `session_end` — session 生命周期
- `subagent_spawning` / `subagent_ended` — subagent 生命周期

**数据：** 内存中的简单统计（toolCalls, sessionsStarted 等）

**架构评估：**
- ✅ 覆盖了最常用的 lifecycle hooks
- ⚠️ 没有拦截 `before_compaction` / `after_compaction`
- ⚠️ `before_prompt_build` 的 >20 消息阈值是硬编码的

### 7.2 analytics

**文件：** `plugins/analytics/index.ts`

**注册 Hooks：**
- `after_tool_call` — 追踪工具使用次数和耗时
- `agent_end` — 写入 session 统计到 `memory/analytics.md`

**数据：**
- `toolStats Map<toolName, {count, totalDuration, errors}>`
- `sessionData Map<sessionId, SessionStats>`

**输出格式：** Markdown 表格（Top Tools 列表）

**架构评估：**
- ✅ 简单有效的遥测
- ⚠️ 没有使用 `api.runtime` subagent 来异步处理数据
- ⚠️ 缺少 GrowthBook / Datadog 集成（进化清单 P4）

### 7.3 session-save

**文件：** `plugins/session-save/index.ts`

**注册 Hooks：**
- `agent_end` — 保存会话摘要到 `memory/sessions/`

**过滤条件：** `minDuration: 30000`（30秒）

**提取内容：**
- 首个 user message 作为 task
- 从 assistant messages 提取 tool counts
- 简单决策提取（空数组）

**架构评估：**
- ✅ 实现了 P0 ExtractMemories 目标
- ⚠️ 30秒阈值可能过滤掉很多短 session
- ⚠️ 决策提取逻辑为空，没有真正实现 ExtractMemories

### 7.4 subagent-aggregate

**文件：** `plugins/subagent-aggregate/index.ts`

**注册 Hooks：**
- `subagent_ended` — 收集 subagent 结果
- `agent_end` — 保存聚合结果

**存储：** `memory/subagent-results.json`

**数据结构：**
```typescript
interface SubagentResult {
  sessionKey: string;
  outcome: string;
  reason: string;
  duration?: number;
  endedAt: string;
  error?: string;
}
```

**架构评估：**
- ✅ 实现了 subagent 结果聚合
- ⚠️ 没有实现真正的 Coordinator Mode（只是收集结果，没有路由）

### 7.5 code-change

**文件：** `plugins/code-change/index.ts`

**注册 Hooks：**
- `after_tool_call` — 检测 git 操作

**检测命令：** git, diff, status, log, add, commit, push, pull, stash

**触发条件：**
- `git status` 有 modified/new files
- `git diff` > 50 字符
- `git commit` / `git push`

**输出：** `memory/code-changes.md`，Markdown 格式

**架构评估：**
- ✅ 实现了 P0 VERIFICATION_AGENT 的代码变更检测部分
- ⚠️ 没有后续验证（运行测试、检查 lint）
- ⚠️ 没有和 CI 系统集成

### 7.6 scheduled-tasks

**文件：** `plugins/scheduled-tasks/index.ts`

**注册 Hooks：**
- `session_start` — 检测定时任务并 push 提醒
- `gateway_start` — 初始化 tasks 文件

**Push 模式：** prependContext 注入（不是直接推飞书）

**Cron 解析：** 支持 `*`, `*/n`, `,`, `-`

**防重复：** `lastCheckMinute` 跟踪（同分钟只推一次）

**架构评估：**
- ✅ 实现了定时任务检查的 hook 拦截
- ⚠️ prependContext 依赖 AI 回复才推，不是主动推送
- ⚠️ lastRun 更新但没有真正执行任务内容

---

## 8. Hook 类型完整对照表

### 8.1 完整 Hook 列表（按执行顺序）

| Hook | 时机 | 可用数据 |
|------|------|---------|
| `before_model_resolve` | session 前，无 messages | provider/model 覆盖 |
| `before_prompt_build` | session 加载后 | messages, prependContext |
| `before_agent_reply` | inline actions 后、LLM 前 | 可返回合成回复 |
| `agent_end` | 完成后的最终状态 | messages, metadata |
| `before_tool_call` | 工具执行前 | toolName, params, 可 block |
| `after_tool_call` | 工具执行后 | toolName, params, result |
| `before_compaction` | 压缩前 | 可注入警告 |
| `after_compaction` | 压缩后 | 验证/记录 |
| `session_start` | session 开始 | sessionKey |
| `session_end` | session 结束 | sessionKey, stats |
| `subagent_spawning` | subagent 启动前 | subagentSessionKey |
| `subagent_ended` | subagent 结束后 | subagentSessionKey, result |
| `gateway_start` | Gateway 启动 | - |
| `gateway_stop` | Gateway 停止 | - |
| `message_received` | 收到消息 | envelope |
| `message_sending` | 发送消息前 | 可 cancel |
| `message_sent` | 消息发送后 | envelope |
| `before_install` | 安装前 | 可 block |

### 8.2 Claude Code vs OpenClaw Hook 对照

| Claude Code | OpenClaw | 状态 |
|------------|---------|------|
| PreToolUse | `before_tool_call` | ✅ 等价 |
| PostToolUse | `after_tool_call` | ✅ 等价 |
| PreAgentStart | `before_agent_start` | ⚠️ legacy |
| PostAgentStart | - | ❌ 无 |
| SubagentStart | `subagent_spawning` | ✅ 等价 |
| SubagentStop | `subagent_ended` | ✅ 等价 |
| PreCompact | `before_compaction` | ✅ 等价 |
| PostCompact | `after_compaction` | ✅ 等价 |
| SessionStart | `session_start` | ✅ 等价 |
| SessionEnd | `session_end` | ✅ 等价 |
| Setup | `gateway_start` | ✅ 等价 |
| CwdChanged | - | ❌ 无 |
| FileChanged | - | ❌ 无 |
| InstructionsLoaded | - | ❌ 无 |
| PromptSubmission | - | ❌ 无 |
| UserIntent | - | ❌ 无 |
| Idle | - | ❌ 无 |
| Wake | - | ❌ 无 |
| PreCommand | - | ❌ 无 |
| PostCommand | - | ❌ 无 |
| PrePromptBuild | `before_prompt_build` | ✅ 等价 |
| PostPromptBuild | - | ❌ 无 |
| Stop | - | ❌ 无 |
| StopFailure | - | ❌ 无 |

**差距：** 4923 行 Claude Code Hook 系统，OpenClaw 覆盖约 60%

---

## 9. 差距分析与机会

### 9.1 Plugin 层面的差距

| 进化任务 | Claude Code 行数 | 我们的 Plugin | 差距 |
|---------|-----------------|-------------|------|
| Compact 系统 | 1626 | ❌ 无 | 无 `before_compaction` 实现 |
| SessionMemory | - | agent-hooks | 阈值硬编码 |
| ExtractMemories | - | session-save | 决策提取为空 |
| AutoDream | - | auto-dream skill | 非 plugin |
| BriefTool | - | ❌ 无 | hook-only 未实现 |
| Agent Snapshot | - | ❌ 无 | 非 plugin |
| VERIFICATION | - | code-change | 仅检测，无验证 |
| Hooks 扩展 | 4923 | agent-hooks | 约 60% 覆盖 |

### 9.2 架构层面的差距

| 任务 | 架构差距 | 可补救？ |
|------|---------|---------|
| Fork-Join Cache | sessions 完全独立 | ❌ |
| Coordinator Mode | 需要 session 路由 | ⚠️ 可通过 sessions_send 实现受限版 |
| MCP Channels/KAIROS | Gateway 通道机制 | ⚠️ 读懂 feishu channel 实现后研究 |
| MCP OAuth | Gateway auth 层 | ❌ |
| RemoteSessionManager | ACP remote | ⚠️ 已有部分实现 |

### 9.3 最值得写的 3 个新 Plugin

**1. compact-warning**
- 目标：补 P0 Compact 系统短板
- Hook：`before_compaction` 检测即将满的上下文
- 功能：在 transcript 中注入压缩警告，触发 microCompact（轻度压缩）

**2. brief-tool**
- 目标：补 P0 BriefTool
- Hook：`agent_end` 生成 1-3 句进度摘要
- 输出：`memory/brief/YYYY-MM-DD.md`

**3. away-summary**
- 目标：补 P4 Away Summary
- Hook：`session_end` 检测用户离开
- 输出：`memory/away/YYYY-MM-DD.md`

### 9.4 最高价值的源码研究

**MCP Channels / KAIROS 路径：**
1. 读 `docs/channels/` 下的飞书 channel 文档
2. 理解 Gateway 如何接收外部事件
3. 研究 `channelNotification.ts` 等效在 OpenClaw 的实现
4. 看能否通过 plugin 的 `registerHttpRoute` 实现外部事件注入

---

## 附录：Plugin SDK 关键 Subpaths

| Subpath | 用途 |
|---------|------|
| `plugin-sdk/plugin-entry` | `definePluginEntry` |
| `plugin-sdk/core` | `defineChannelPluginEntry` |
| `plugin-sdk/runtime-store` | `createPluginRuntimeStore` |
| `plugin-sdk/infra-runtime` | System event/heartbeat helpers |
| `plugin-sdk/agent-runtime` | Agent dir/identity/workspace helpers |
| `plugin-sdk/channel-inbound` | Debounce, mention matching, envelope helpers |
| `plugin-sdk/channel-contract` | Channel contract types |
| `plugin-sdk/approval-runtime` | Exec/plugin approval helpers |
| `plugin-sdk/http-route` | HTTP route registration |
| `plugin-sdk/testing` | Test utilities |
