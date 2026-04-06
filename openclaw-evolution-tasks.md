# OpenClaw Agent Harness 进化任务清单（精选版）

> 过滤掉非 harness 功能（IDE集成、虚拟宠物、平台特性等）
> 基于 Claude Code v2.1.88 源码，2026-04-05
> 最后更新：2026-04-06（源码分析 + plugin 完善）

---

## 筛选原则

**保留**：Agent harness 核心功能 — 记忆、压缩、协作、工具、钩子、远程执行
**剔除**：UI/UX（宠物、IDE集成、彩色diff）、平台特性（Voice、Chrome扩展）、商业功能（Billing）、CLI特性（Auth命令、结构化输出）

---

## P0 — 核心，必须实现

### 0.0 Compact 系统（1626 行）⭐⭐⭐⭐⭐

```typescript
// src/services/compact/ + src/services/autoCompact.ts
// 三层上下文压缩：

// Layer 1: MEMORY.md（200行索引）
// Layer 2: topic files（按需加载）
// Layer 3: full transcript（可搜索）

// 关键参数：
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
MAX_CONCESSIVE_AUTOCOMPACT_FAILURES = 3
```

**OpenClaw**：✅ 有 `before_compaction` / `after_compaction` hooks（agent-hooks plugin 已实现）
**差距**：无 `microCompact`（轻度压缩）、无 circuit breaker

**2026-04-06 更新**：✅ `before_compaction` hook 已实现（agent-hooks plugin），注入记忆 flush 提醒

| 子任务 | 状态 |
|--------|------|
| before_compaction hook | ✅ 已实现 |
| after_compaction hook | ✅ 已实现 |
| compactWarningHook（提前警告） | ❌ 未实现 |
| microCompact（轻度压缩） | ❌ 未实现 |
| circuit breaker | ❌ 未实现 |

---

### 1.1 SessionMemory（周期性会话笔记）⭐⭐⭐⭐

```typescript
// src/services/SessionMemory/sessionMemory.ts
DEFAULT_SESSION_MEMORY_CONFIG = {
  minMinutesBetweenUpdates: 15,
  minTurnsBetweenUpdates: 5,
  tokenThreshold: 8000,
};
```

**OpenClaw**：`HEARTBEAT.md` + `agent_end` hook，可实现
**优先级**：高

---

**2026-04-06 更新**：✅ session-save plugin 已完善，实现真实决策提取 + tool_call block 解析

| 子任务 | 状态 |
|--------|------|
| agent_end hook | ✅ 已实现 |
| sessions_spawn subagent | ✅ 已实现 |
| 决策提取逻辑 | ✅ 2026-04-06 修复（之前为空） |
| tool_call block 解析 | ✅ 2026-04-06 修复（之前用文本匹配） |

### 1.2 ExtractMemories（查询结束提取）⭐⭐⭐⭐

```typescript
// src/services/extractMemories/
// 查询结束（无 tool calls）→ Fork subagent → 提取记忆到 memory/
```

**OpenClaw**：`agent_end` hook + `sessions_spawn`，可实现
**优先级**：高

---

### 1.3 AutoDream（梦境记忆整合）⭐⭐⭐⭐⭐

```typescript
// src/services/autoDream/autoDream.ts
// Gate 顺序（最便宜先检查）：
// 1. Time gate：hours >= minHours（默认 24h）
// 2. Session gate：transcript 数 >= minSessions（默认 5）
// 3. Lock：防止并发 consolidation

// 核心文件：
// - consolidationPrompt.ts — 构建整合 prompt
// - consolidationLock.ts — 文件锁实现
// - DreamTask.ts — 后台任务注册
```

**OpenClaw**：`cron` + `subagent_spawning` lock + `sessions_spawn`，可实现
**优先级**：高

---

### 1.4 BriefTool（主动摘要）⭐⭐⭐

```typescript
// src/tools/BriefTool/
// 用户离开时生成 1-3 句进度摘要
// 轻量级，不需要完整 compaction
```

**OpenClaw**：可合并到 SessionMemory 或 HEARTBEAT.md
**优先级**：中

---

### 1.5 Agent Triggers / Cron 调度 ⭐⭐⭐⭐

```typescript
feature('AGENT_TRIGGERS')
feature('AGENT_TRIGGERS_REMOTE')

// ScheduleCronTool 完整实现
// src/tools/ScheduleCronTool/
```

**OpenClaw**：`cron` tool 已实现，但 trigger 能力较弱
**优先级**：高

---

### 1.6 Tool Search（智能工具推荐）⭐⭐⭐

```typescript
// src/tools/ToolSearchTool/
// 延迟工具搜索，按需加载
// src/tools/shared/spawnMultiAgent.ts
```

**OpenClaw**：无，等价于 OpenClaw 的 SKILL.md 动态加载
**优先级**：中

---

## P1 — 差异化核心

### 2.1 Coordinator Mode（多 Agent 协调）⭐⭐⭐⭐

```typescript
// src/coordinator/coordinatorMode.ts
// CLAUDE_CODE_COORDINATOR_MODE 环境变量控制
// 多 Agent 编排：创建、销毁、路由
```

**OpenClaw**：多 agent 已在讨论中，但无 coordinator 模式
**优先级**：高

---

### 2.2 Fork-Join Cache（KV Cache 共享）⭐⭐⭐⭐⭐

```typescript
// forkContextMessages — subagent 复用 parent 的 messages prefix
type CacheSafeParams = {
  systemPrompt: SystemPrompt
  tools: Tool[]
  model: string
  forkContextMessages: Message[]  // parent 消息前缀
}
```

**OpenClaw**：❌ 完全不兼容，sessions 完全独立
**优先级**：最高（架构差距）
**建议**：通过 `sessions_spawn` + context 传递实现（不等价但可凑合）

---

### 2.3 Agent Memory Snapshot ⭐⭐⭐

```typescript
feature('AGENT_MEMORY_SNAPSHOT')
// subagent 定期快照内存状态
```

**OpenClaw**：无
**优先级**：中

---

**2026-04-06 更新**：✅ code-change plugin 已增强，新增 test/lint 验证逻辑

| 子任务 | 状态 |
|--------|------|
| git 操作检测 | ✅ 已实现 |
| 变更日志记录 | ✅ 已实现 |
| CI/test 验证 | ✅ 2026-04-06 新增（检测 test/lint 命令） |
| 与 CI 系统集成 | ❌ 未实现 |

### 2.4 VERIFICATION_AGENT（验证 Agent）⭐⭐⭐

```typescript
feature('VERIFICATION_AGENT')
// 代码变更后自动验证
```

**OpenClaw**：无
**优先级**：中

---

### 2.5 Anti-Distillation（反蒸馏）⭐⭐⭐

```typescript
feature('ANTI_DISTILLATION_CC')
// 向 API 请求注入假工具，防止竞争对手提取模型行为
```

**OpenClaw**：❌ 无（也不太需要）
**优先级**：低

---

## P2 — Hooks 系统完整版

### 3.1 Hooks 系统扩展（4923 行）⭐⭐⭐⭐

**2026-04-06 更新**：✅ agent-hooks plugin 已新增 `before_compaction` + `after_compaction`，差距收窄

| Hook | Claude Code | OpenClaw | 状态 |
|------|------------|---------|------|
| PreToolUse | ✅ | ✅ `before_tool_call` | ✅ |
| PostToolUse | ✅ | ✅ `after_tool_call` | ✅ |
| PreAgentStart | ✅ | ⚠️ `before_agent_start` | ⚠️ legacy |
| SubagentStart | ✅ | ✅ `subagent_spawning` | ✅ |
| SubagentStop | ✅ | ✅ `subagent_ended` | ✅ |
| PreCompact | ✅ | ✅ `before_compaction` | ✅ 新增 |
| PostCompact | ✅ | ✅ `after_compaction` | ✅ 新增 |
| SessionStart | ✅ | ✅ `session_start` | ✅ |
| SessionEnd | ✅ | ✅ `session_end` | ✅ |
| PrePromptBuild | ✅ | ✅ `before_prompt_build` | ✅ |
| PostPromptBuild | ✅ | ❌ | ❌ |
| PreCommand | ✅ | ❌ | ❌ |
| PostCommand | ✅ | ❌ | ❌ |
| Stop | ✅ | ❌ | ❌ |
| StopFailure | ✅ | ❌ | ❌ |
| Idle | ✅ | ❌ | ❌ |
| Wake | ✅ | ❌ | ❌ |

**覆盖率**：从 ~60% → ~75%（新增 before/after_compaction）

### 3.1 Hooks 系统扩展（4923 行）⭐⭐⭐⭐

```typescript
// src/utils/hooks.ts
// 完整事件类型：

PreToolUse, PostToolUse, PostToolUseFailure,
Stop, StopFailure,
PreAgentStart, PostAgentStart,
SubagentStart, SubagentStop,
PreCompact, PostCompact,
SessionStart, SessionEnd,
Setup, CwdChanged, FileChanged, InstructionsLoaded,
PromptSubmission, UserIntent,
Idle, Wake,
// 新增：
PreCommand, PostCommand,
PrePromptBuild, PostPromptBuild,
```

**OpenClaw**：有 `before_tool_call` 等，差距大
**优先级**：高

---

### 3.2 Memory 类型系统 ⭐⭐⭐

```typescript
// src/memdir/memoryTypes.ts
// MemoryType：episodic, semantic, working, project, user
// Frontmatter 格式：
// ---
// type: episodic
// description: "..."
// ---
```

**OpenClaw**：`MEMORY.md` 简单文本，无类型
**优先级**：中

---

## P3 — Remote + MCP

### 4.1 RemoteSessionManager（远程会话管理）⭐⭐⭐⭐

```typescript
// src/remote/RemoteSessionManager.ts
// src/bridge/remoteBridgeCore.ts
// 远程 bridge：ssh、容器内运行
```

**OpenClaw**：ACP remote，部分等价
**优先级**：高

---

### 4.2 MCP 通道通知（Channels）⭐⭐⭐⭐⭐

```typescript
// src/services/mcp/channelNotification.ts
// 外部事件（Telegram, Discord, webhooks）推入运行中的 Claude Code
// feature('KAIROS') || feature('KAIROS_CHANNELS')
// 通过 MCP server 实现双向通信
```

**OpenClaw**：Gateway 已有通道机制，可研究
**优先级**：最高（KAIROS 核心）

---

### 4.3 MCP OAuth（动态 MCP 认证）⭐⭐⭐

```typescript
// src/services/mcp/useManageMCPConnections.ts
// OAuth 认证 flow for MCP servers
```

**OpenClaw**：MCP auth 在讨论中
**优先级**：中

---

## P4 — 分析 + 后台任务

### 5.1 Analytics / Telemetry（完整遥测）⭐⭐⭐

```typescript
// src/services/analytics/
// growthbook.ts — GrowthBook 特性开关（CDN 缓存，异步加载）
// datadog.ts — Datadog 集成
// firstPartyEventLogger.ts — 事件日志
// logEvent(eventName, metadata)
```

**OpenClaw**：审计日志有，GrowthBook/Datadog 无
**优先级**：中（可渐进）

---

### 5.2 Background Task（后台任务）⭐⭐⭐

```typescript
// src/state/useBackgroundTaskNavigation.ts
// src/state/useTaskListWatcher.ts
// 任务列表监控 + 导航
```

**OpenClaw**：部分有（tasks），可补充
**优先级**：中

---

### 5.3 Away Summary（离开摘要）⭐⭐⭐

```typescript
// src/services/awaySummary.ts
// 用户离开后回来，显示 1-3 句会话摘要
// 比 BriefTool 更轻量
```

**OpenClaw**：可合并到 SessionMemory
**优先级**：中

---

### 5.4 teamMemorySync（团队共享内存）⭐⭐⭐

```typescript
// src/services/teamMemorySync/
// 团队多个 Claude Code 实例共享内存
```

**OpenClaw**：无（多用户场景）
**优先级**：低（目前主要是单用户）

---

## 剔除的非 harness 功能

| 功能 | 原因 |
|---|---|
| BUDDY 虚拟宠物 | UI/UX，不是 harness |
| IDE 深度集成 | VSCode 特定，平台锁定 |
| Clipboard/Selection | UI 特性 |
| Color Diff | UI 特性 |
| Voice I/O | 平台特性 |
| Login/Auth CLI | 认证独立于 harness |
| Plugin Architecture | OpenClaw 已有 |
| Chrome Extension | 平台特定 |
| Auto Mode | CLI 特性 |
| Settings Sync | 平台/同步特性 |
| Prevent Sleep | OS 特性 |
| Billing | 商业功能 |
| CLI Structured IO | CLI 输出格式 |
| Code Indexing | embedding 相关，非核心 |
| Direct Connect | 远程访问，非 harness 核心 |

---

## 最终优先级总结

```
P0（核心）
├── 0.0 Compact 系统
├── 1.1 SessionMemory
├── 1.2 ExtractMemories
├── 1.3 AutoDream
├── 1.5 Agent Triggers / Cron
└── 2.1 Coordinator Mode

P1（差异化）
├── 2.2 Fork-Join Cache ← 架构最大差距
├── 2.3 Agent Memory Snapshot
└── 2.4 VERIFICATION_AGENT

P2（Hooks + 类型）
├── 3.1 Hooks 系统完整版
└── 3.2 Memory 类型系统

P3（Remote + MCP）
├── 4.1 RemoteSessionManager
├── 4.2 MCP Channels ← KAIROS 核心
└── 4.3 MCP OAuth

P4（辅助）
├── 5.1 Analytics/Telemetry
├── 5.2 Background Tasks
├── 5.3 Away Summary
└── 5.4 teamMemorySync
```

---

## 核心结论

**最大架构差距**：Fork-Join Cache（sessions 完全独立的根本性差异）

**最重要遗漏**：MCP Channels / KAIROS（always-on agent 的通信层）

**最实际路径**：Compact → SessionMemory → ExtractMemories → AutoDream（记忆系统是最高 ROI）

**Analytics**：有意义但优先级靠后，等核心稳定后再补充

---

## 2026-04-06 Plugin 完善记录

### 本次修改

| Plugin | 修改内容 | 对应进化任务 |
|--------|---------|-------------|
| session-save | 实现真实决策提取 + tool_call block 解析 | 1.2 ExtractMemories |
| code-change | 新增 test/lint 验证逻辑 | 2.4 VERIFICATION_AGENT |
| agent-hooks | 新增 before_compaction + after_compaction hooks | 0.0 Compact 系统 |

### 剩余 Plugin 完善机会

| Plugin | 待完善 | 难度 |
|--------|--------|------|
| session-save | 降低 minDuration 阈值（30s → 10s）| 低 |
| analytics | 增加 subagent 异步处理 + 写入 memory/analytics.md | 中 |
| scheduled-tasks | 支持更多 cron 格式 + 主动推送（不依赖 AI 回复）| 中 |
| agent-hooks | 可配置消息阈值 | 低 |

### 待新增 Plugin

| Plugin | 目标 | 优先级 |
|--------|------|--------|
| brief-tool | 生成 1-3 句会话摘要 | 🔴 高 |
| away-summary | 用户离开时写入 memory/away/ | 🔴 高 |
| http-inject | HTTP route 接收外部事件注入 agent | 🟡 中 |
| coordinator | 多 agent 路由协调 | 🟡 中 |
