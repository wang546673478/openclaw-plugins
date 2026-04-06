# OpenClaw Agent Harness 进化实现文档

> 基于 OpenClaw 源码（`dist/plugin-sdk/`）+ 官方文档 + Claude Code v2.1.88 源码对比
> 日期：2026-04-05

---

## 一、Compact 系统（0.0）

### Claude Code 实现

```typescript
// 三层压缩：
// Layer 1: MEMORY.md（200行索引）
// Layer 2: topic files（按需加载）
// Layer 3: full transcript（可搜索）

AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
MAX_CONCESSIVE_AUTOCOMPACT_FAILURES = 3

// microCompact：轻度压缩，只清理过期 tool results
// circuit breaker：连续失败3次停止压缩
```

### OpenClaw 现状

- ✅ `before_compaction` / `after_compaction` hooks
- ✅ `compact` tool（`/compact` 命令）
- ✅ session transcript 持久化在磁盘
- ✅ auto-compaction（context overflow 时触发）
- ✅ `agents.defaults.compaction.notifyUser` 通知选项
- ✅ 支持不同 model 进行 compaction

### 差距

| 缺失 | 说明 |
|---|---|
| `compactWarningHook` | 接近阈值时提前警告，无对应 hook |
| `microCompact` | 只有全量压缩，无轻度压缩机制 |
| Circuit breaker | 无连续失败保护机制 |
| 三层架构 | OpenClaw 只有全量 summarization，无分层加载 |

### 实现方案

```typescript
// 1. 添加 before_compaction 提前警告
// 在 compact.d.ts 中扩展 hook：
type PluginHookBeforeCompactionEvent = {
  messageCount: number;
  tokenCount: number;         // 当前 token 数
  threshold: number;          // 触发阈值
  warningOnly: boolean;       // true = 提前警告，不实际压缩
};

// 2. 添加 microCompact 支持
// 在 hook 中允许"轻度压缩"场景：
type PluginHookBeforeCompactionEvent = {
  ...
  severity: 'warning' | 'full';  // warning = microCompact
};
```

---

## 二、SessionMemory（1.1）

### Claude Code 实现

```typescript
DEFAULT_SESSION_MEMORY_CONFIG = {
  minMinutesBetweenUpdates: 15,
  minTurnsBetweenUpdates: 5,
  tokenThreshold: 8000,
};
// 周期性写入会话摘要到 memory/
```

### OpenClaw 现状

- ✅ `HEARTBEAT.md` 机制（周期性检查清单）
- ✅ `agent_end` hook（有 `messages` 可分析）
- ⚠️ 无自动周期性写入，需要靠 agent 自觉

### 实现方案

```typescript
// 在 HEARTBEAT.md 中添加自动任务：
// ```markdown
// # HEARTBEAT.md
// ## 自动记忆保存检查
// - 检查：距离上次记忆保存 > 15 分钟 AND 对话轮数 > 5
// - 检查：token 数量 > 8000
// - 执行：调用 memory 工具保存摘要
// ```

// 或通过 cron + sessions_spawn 实现：
// cron: "*/15 * * * *" 检查条件，触发记忆保存 subagent
```

---

## 三、ExtractMemories（1.2）

### Claude Code 实现

```typescript
// 查询结束（无 tool calls）→ Fork subagent → 提取记忆到 memory/
// 触发条件：连续 N 轮无 tool call
```

### OpenClaw 现状

- ✅ `agent_end` hook（有 messages、success、durationMs）
- ✅ `sessions_spawn` 可以 fork subagent
- ✅ `memory_search` / `memory_get` 已有

### 实现方案

```typescript
// plugins/my-memory/plugin.ts
export default {
  hooks: {
    agent_end: async ({ messages, success, sessionKey }) => {
      // 检测是否连续 N 轮无 tool call
      const recentNoTool = messages.slice(-5).every(m => !hasToolCalls(m));
      if (!recentNoTool) return;

      // Fork subagent 提取记忆
      await sessions_spawn({
        task: `从以下对话提取关键信息到 memory/ 目录...`,
        runtime: 'subagent',
        mode: 'run',
      });
    }
  }
}
```

---

## 四、AutoDream（1.3）

### Claude Code 实现

```typescript
// Gate 顺序（最便宜先检查）：
// 1. Time gate：hours >= minHours（默认 24h）
// 2. Session gate：transcript 数 >= minSessions（默认 5）
// 3. Lock 文件：防止并发 consolidation

// consolidationLock.ts — 文件锁实现
// DreamTask.ts — 后台任务注册
```

### OpenClaw 现状

- ✅ `cron` tool（定时调度）
- ✅ `subagent_spawning` hook（可以阻止并发）
- ✅ `sessions_spawn`（fork subagent）
- ⚠️ 无时间/session gate 检查机制
- ⚠️ 无 consolidation lock 文件实现

### 实现方案

```typescript
// 1. cron 定期检查 gates
// HEARTBEAT.md 或 cron task：
cron: "0 * * * *"  // 每小时检查

// 检查逻辑：
const lastRun = readFile('memory/.dream-lock');
const hoursSinceLastRun = (Date.now() - lastRun.mtime) / 3600000;
const sessionCount = listSessionsSince(lastRun.mtime).length;

if (hoursSinceLastRun >= 24 && sessionCount >= 5) {
  // 尝试获取锁
  if (tryAcquireLock('memory/.dream-lock')) {
    await sessions_spawn({
      task: buildDreamPrompt(),
      runtime: 'subagent',
      mode: 'run',
    });
  }
}

// 2. subagent_ended 清理锁
```

---

## 五、Agent Triggers / Cron（1.5）

### Claude Code 实现

```typescript
feature('AGENT_TRIGGERS')
feature('AGENT_TRIGGERS_REMOTE')
// ScheduleCronTool — 完整的 cron 调度实现
```

### OpenClaw 现状

- ✅ `cron` tool（`ScheduleCronTool`）
- ✅ `cron` hook events
- ✅ `agents.defaults.cron` 配置
- ⚠️ 无 `AGENT_TRIGGERS_REMOTE`（远程触发）

### 实现方案

```typescript
// OpenClaw 的 cron tool 已经可用：
// - cron("*/5 * * * *", task)
// - 支持 cron tool 在 agent 中调度任务

// AGENT_TRIGGERS_REMOTE 等价于：
// 通过 sessions_send(sessionKey, message) 从外部触发 agent
```

---

## 六、Tool Search（1.6）

### Claude Code 实现

```typescript
// src/tools/ToolSearchTool/
// 延迟工具搜索，按需加载
// 支持 "select:<tool_name>" 直接选择
```

### OpenClaw 现状

- ✅ Skills 动态加载（`SKILL.md` 按需注入）
- ✅ `skills.load.watch` 热加载
- ⚠️ 无专门的 Tool Search 工具

### 实现方案

```typescript
// OpenClaw 的等价物是 SKILL.md 动态加载：
// - skills 已经是按需加载的
// - 通过 skill gating (requires.env, requires.bins) 过滤
// - 可考虑添加 ToolSearchTool 作为 skills 的补充
```

---

## 七、Coordinator Mode（2.1）

### Claude Code 实现

```typescript
// CLAUDE_CODE_COORDINATOR_MODE 环境变量控制
// 多 Agent 编排：创建、销毁、路由
// src/coordinator/coordinatorMode.ts
```

### OpenClaw 现状

- ✅ 多 agent 支持（`agents.list[]`）
- ✅ `bindings` 路由机制
- ✅ `sessions_spawn` 子 agent
- ⚠️ 无 coordinator 编排层（创建/销毁/路由自动化）

### 实现方案

```typescript
// 在 SKILL.md 中实现协调逻辑：
// ```markdown
// ---
// name: coordinator
// ---
// 当用户要求管理多个子任务时：
// 1. 分解任务为独立子任务
// 2. 使用 sessions_spawn 并行执行
// 3. 汇总结果返回给用户
// ```

// 未来可通过专用 hook + tool 实现更紧密的 coordinator
```

---

## 八、Fork-Join Cache（2.2）⚠️ 架构差距

### Claude Code 实现

```typescript
type CacheSafeParams = {
  systemPrompt: SystemPrompt
  tools: Tool[]
  model: string
  forkContextMessages: Message[]  // parent 消息前缀
}
// subagent 可以复用 parent 的 KV cache
```

### OpenClaw 现状

- ❌ sessions 完全独立
- ❌ 无 forkContextMessages 机制
- ❌ API prompt cache 无法跨 session 共享

### 实现方案（妥协）

```typescript
// OpenClaw 无法实现真正的 Fork-Join Cache
// 但可以通过以下方式缓解：

// 1. sessions_spawn 时传递完整 context
await sessions_spawn({
  task: `基于以下上下文继续工作...\n${summarizedHistory}`,
  runtime: 'subagent',
  mode: 'run',
});

// 2. 使用 compact 减少 context 大小
// 3. prompt caching 由 provider 处理（非 OpenClaw 层）
```

---

## 九、Agent Memory Snapshot（2.3）

### Claude Code 实现

```typescript
feature('AGENT_MEMORY_SNAPSHOT')
// subagent 定期快照内存状态
```

### OpenClaw 现状

- ⚠️ 无对应功能
- ⚠️ subagent 没有定期快照机制

### 实现方案

```typescript
// 通过 cron + sessions_spawn 实现：
cron("*/30 * * * *", async () => {
  // 检查是否有 running subagent
  const running = await sessions_list({ activeMinutes: 30 });
  if (running.length > 0) {
    // 快照到 memory/
    await memory_update({ key: 'subagent-snapshot', value: {...} });
  }
});
```

---

## 十、VERIFICATION_AGENT（2.4）

### Claude Code 实现

```typescript
feature('VERIFICATION_AGENT')
// 代码变更后自动验证
```

### OpenClaw 现状

- ⚠️ 无对应功能

### 实现方案

```typescript
// 通过 hook + cron 实现：
// 1. before_agent_reply 检测代码变更
// 2. 触发验证 subagent

hooks: {
  before_agent_reply: async ({ messages }) => {
    const lastCodeChange = detectCodeChange(messages);
    if (lastCodeChange && needsVerification(lastCodeChange)) {
      await sessions_spawn({
        task: `验证以下代码变更：${lastCodeChange.diff}`,
        runtime: 'subagent',
        mode: 'run',
      });
    }
  }
}
```

---

## 十一、Hooks 系统完整版（3.1）

### Claude Code 实现（49+ 事件）

```
PreToolUse, PostToolUse, PostToolUseFailure,
Stop, StopFailure,
PreAgentStart, PostAgentStart,
SubagentStart, SubagentStop,
PreCompact, PostCompact,
SessionStart, SessionEnd,
Setup, CwdChanged, FileChanged, InstructionsLoaded,
PromptSubmission, UserIntent,
Idle, Wake,
PreCommand, PostCommand,
PrePromptBuild, PostPromptBuild,
```

### OpenClaw 现状（部分实现）

```
before_model_resolve
before_prompt_build
before_agent_start (legacy)
before_agent_reply
agent_end
before_compaction / after_compaction
before_tool_call / after_tool_call
before_install
tool_result_persist
message_received / message_sending / message_sent
session_start / session_end
gateway_start / gateway_stop
```

### 差距

| 缺失 | Claude Code | OpenClaw |
|---|---|---|
| PreCommand/PostCommand | ✅ | ❌ |
| PromptSubmission | ✅ | ❌ |
| UserIntent | ✅ | ❌ |
| Idle/Wake | ✅ | ❌ |
| CwdChanged/FileChanged | ✅ | ❌ |
| SubagentStart/SubagentStop | ⚠️ | `subagent_spawning/ended` |
| PreAgentStart/PostAgentStart | ✅ | `before_agent_start` |

### 实现方案

```typescript
// 在 types.d.ts 中扩展：
export type PluginHookEvent =
  // 现有...
  | 'pre_command'
  | 'post_command'
  | 'prompt_submission'
  | 'user_intent'
  | 'idle'
  | 'wake'
  | 'cwd_changed'
  | 'file_changed';
```

---

## 十二、Memory 类型系统（3.2）

### Claude Code 实现

```typescript
// MemoryType：
// - episodic（情景记忆）
// - semantic（语义记忆）
// - working（工作记忆）
// - project（项目记忆）
// - user（用户记忆）

// Frontmatter 格式：
// ---
// type: episodic
// description: "..."
// ---
```

### OpenClaw 现状

- ✅ `MEMORY.md` 简单文本
- ✅ `memory/YYYY-MM-DD.md` 日常笔记
- ✅ `memory_search` 语义搜索
- ❌ 无类型系统
- ❌ 无 frontmatter 格式

### 实现方案

```typescript
// 创建 memory-types skill：
// memory-types/SKILL.md
// ```markdown
// ---
// name: memory-types
// ---
// 当保存记忆时，使用以下 frontmatter 格式：
// ---
// type: <episodic|semantic|working|project|user>
// description: "简短描述"
// created: 2026-04-05
// ---
// ```

// 或通过 before_tool_call hook 拦截 memory_write 验证格式
```

---

## 十三、RemoteSessionManager（4.1）

### Claude Code 实现

```typescript
// src/remote/RemoteSessionManager.ts
// src/bridge/remoteBridgeCore.ts
// 远程 bridge：ssh、容器内运行
```

### OpenClaw 现状

- ✅ ACP remote（`openclaw remote`）
- ✅ `nodes` tool（设备发现和目标）
- ✅ `host` 参数支持远程执行
- ⚠️ 无完整的 RemoteSessionManager

### 实现方案

```typescript
// OpenClaw 已有 ACP remote，等价功能：
// - openclaw remote connect <host>
// - openclaw remote list
// - 使用 nodes tool 发现远程节点

// 如需增强，可研究：
// - bridge 远程会话恢复
// - 远程文件同步
```

---

## 十四、MCP Channels（4.2）⭐ KAIROS 核心

### Claude Code 实现

```typescript
// src/services/mcp/channelNotification.ts
// feature('KAIROS') || feature('KAIROS_CHANNELS')
// 外部事件（Telegram, Discord, webhooks）推入对话
// 通过 MCP server 实现双向通信
```

### OpenClaw 现状

- ✅ Gateway 已有通道机制（Discord、Telegram等）
- ✅ `message` tool 可以发送跨通道消息
- ✅ MCP server 支持
- ⚠️ 无 notifications/claude/channel 通知机制

### 实现方案

```typescript
// OpenClaw 的 Gateway 通道 ≈ Claude Code 的 Channels
// 差异：OpenClaw 是 Hub-and-Spoke，Claude Code 是事件注入

// 等价实现：
// 1. 外部事件 → Gateway webhook → 注入 session
// 2. 使用 sessions_send(sessionKey, message)

// 如需 Claude Code 式的 channel notification：
// - 需要 MCP server 支持 notifications 协议
// - Gateway 作为 MCP client 接收通知
```

---

## 十五、MCP OAuth（4.3）

### Claude Code 实现

```typescript
// src/services/mcp/useManageMCPConnections.ts
// OAuth 认证 flow for MCP servers
```

### OpenClaw 现状

- ✅ MCP auth tool（`McpAuthTool`）
- ⚠️ OAuth flow 不完整

### 实现方案

```typescript
// 扩展 McpAuthTool 支持 OAuth：
// - 添加 oauth 流程引导
// - 支持 token refresh
// - 关联 channels 认证机制
```

---

## 十六、Analytics/Telemetry（5.1）

### Claude Code 实现

```typescript
// growthbook.ts — GrowthBook 特性开关
// datadog.ts — Datadog 集成
// firstPartyEventLogger.ts — 事件日志
// logEvent(eventName, metadata)
```

### OpenClaw 现状

- ✅ 审计日志（`auditLog` 配置）
- ⚠️ 无 GrowthBook/Datadog 集成
- ⚠️ 无标准化 event 追踪

### 实现方案

```typescript
// 1. 扩展 hook system 支持事件追踪：
hooks: {
  after_tool_call: ({ tool, durationMs, success }) => {
    logEvent('tool_call', { tool, durationMs, success });
  }
}

// 2. 添加 GrowthBook 支持：
// - 通过 plugin 加载 GrowthBook SDK
// - 使用 feature flag 控制功能

// 3. Datadog 集成：
// - 通过 plugin 加载 datadog-sdk
// - 发送自定义指标
```

---

## 十七、Away Summary（5.3）

### Claude Code 实现

```typescript
// awaySummary.ts
// 用户离开后回来，显示 1-3 句会话摘要
```

### OpenClaw 现状

- ⚠️ 无对应功能
- ✅ 可合并到 SessionMemory

### 实现方案

```typescript
// 在 HEARTBEAT.md 中实现：
// ```markdown
// # Away 检测
// - 检查：距离上次用户消息 > 30 分钟
// - 执行：生成 1-3 句摘要
// - 保存到 memory/away-summary.md
// - 用户返回时读取并展示
// ```
```

---

## 十八、Background Tasks（5.2）

### Claude Code 实现

```typescript
// src/state/useBackgroundTaskNavigation.ts
// src/state/useTaskListWatcher.ts
// 任务列表监控 + 导航
```

### OpenClaw 现状

- ✅ `tasks` tool（TaskCreateTool 等）
- ✅ `sessions_list` 列出活跃 session
- ⚠️ 无任务监控导航

### 实现方案

```typescript
// OpenClaw 已有基本能力：
// - task_* tools 管理任务
// - sessions_list 查看活跃 subagent
// - 可通过 cron 定期检查 + 通知
```

---

## 总结：16 项功能实现状态

| # | 功能 | OpenClaw 现状 | 实现难度 |
|---|---|---|---|
| 0.0 | Compact 系统 | ⚠️ 部分（缺 microCompact/circuit breaker） | 中 |
| 1.1 | SessionMemory | ✅ 可实现（HEARTBEAT.md + hook） | 低 |
| 1.2 | ExtractMemories | ✅ 可实现（agent_end + sessions_spawn） | 低 |
| 1.3 | AutoDream | ✅ 可实现（cron + lock + sessions_spawn） | 中 |
| 1.5 | Agent Triggers | ✅ 已实现（cron tool） | 无 |
| 1.6 | Tool Search | ⚠️ 等价（SKILL.md 动态加载） | 低 |
| 2.1 | Coordinator Mode | ⚠️ 部分（多 agent + bindings） | 高 |
| 2.2 | Fork-Join Cache | ❌ 无法实现（架构差距） | 不可能 |
| 2.3 | Agent Memory Snapshot | ⚠️ 可实现（cron + sessions_list） | 低 |
| 2.4 | VERIFICATION_AGENT | ⚠️ 可实现（hook + sessions_spawn） | 中 |
| 3.1 | Hooks 系统完整版 | ⚠️ 部分（缺 PreCommand/PromptSubmission 等） | 高 |
| 3.2 | Memory 类型系统 | ⚠️ 可实现（SKILL.md 约定） | 低 |
| 4.1 | RemoteSessionManager | ✅ ACP remote 等价 | 低 |
| 4.2 | MCP Channels | ⚠️ Gateway 通道 ≈ 等价 | 中 |
| 4.3 | MCP OAuth | ⚠️ McpAuthTool 部分 | 中 |
| 5.1 | Analytics/Telemetry | ⚠️ 部分（审计日志） | 中 |
| 5.2 | Background Tasks | ✅ 基本可实现 | 低 |
| 5.3 | Away Summary | ⚠️ 可实现（合并到 SessionMemory） | 低 |
| 5.4 | teamMemorySync | ❌ 无多用户场景 | - |

### 可立即实现（低成本）

- 1.1 SessionMemory
- 1.2 ExtractMemories
- 1.3 AutoDream
- 1.6 Tool Search（已有等价）
- 2.3 Agent Memory Snapshot
- 3.2 Memory 类型系统
- 4.1 RemoteSessionManager
- 5.2 Background Tasks
- 5.3 Away Summary

### 需要较大工作

- 0.0 Compact 系统增强
- 2.1 Coordinator Mode
- 3.1 Hooks 系统扩展
- 4.2 MCP Channels
- 5.1 Analytics/Telemetry

### 无法实现

- 2.2 Fork-Join Cache（架构根本性差异）
- 5.4 teamMemorySync（无多用户场景）
