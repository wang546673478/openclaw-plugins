# Claude Code → OpenClaw 功能映射验证文档

> 基于 OpenClaw 源码（`plugin-sdk/`）+ 官方文档验证
> 日期：2026-04-05
> 目的：严格验证每个 Pattern 能否在不改 OpenClaw 源码的情况下实现

---

## 验证依据

### 源码文件

| 文件 | 作用 |
|---|---|
| `dist/plugin-sdk/src/plugins/types.d.ts` | 完整 hook 类型定义 |
| `dist/plugin-sdk/src/agents/subagent-spawn.d.ts` | Subagent spawn 参数 |
| `dist/plugin-sdk/src/agents/compact.d.ts` | Compaction 参数 |
| `dist/plugin-sdk/src/agents/system-prompt.d.ts` | System prompt 构建 |
| `dist/plugin-sdk/src/agents/pi-embedded-runner/run/attempt.prompt-helpers.d.ts` | Prompt hook runner |
| `dist/plugin-sdk/src/agents/tools/common.d.ts` | 工具类型 |

### 官方文档

| 文档 | 关键内容 |
|---|---|
| `concepts/agent-loop.md` | Agent 循环、hook 系统、streaming |
| `concepts/system-prompt.md` | System prompt 组装、prompt mode |
| `concepts/compaction.md` | 压缩机制、自动压缩 |
| `tools/skills.md` | Skills 系统 |

---

## 一、动态提示词 Section 系统

### Claude Code 实现

- `systemPromptSection(name, compute)` — memoized cache
- `DANGEROUS_uncachedSystemPromptSection(name, compute)` — 每次重算
- Section 级缓存，相同 inputs 不重算

### OpenClaw 实际能力

```typescript
// before_prompt_build 返回（types.d.ts 第 1792 行）：
export type PluginHookBeforePromptBuildResult = {
  systemPrompt?: string;
  prependContext?: string;
  
  /** API 层缓存优化 */
  prependSystemContext?: string;  // 注释："so providers can cache it (e.g. prompt caching)"
  appendSystemContext?: string;   // 注释："avoid per-turn token cost"
};
```

**关键注释**：
> "Prepended to the agent system prompt so providers can cache it (e.g. prompt caching). Use for static plugin guidance instead of prependContext to avoid per-turn token cost."

### 映射分析

| 场景 | OpenClaw 实现方式 | API 缓存 |
|---|---|---|
| MCP 信息 | `appendSystemContext` | ✅ |
| Slash commands | `appendSystemContext` | ✅ |
| Memory | `prependContext` | ❌ per-turn |
| Env info | `appendSystemContext` | ✅ |
| Skills | `appendSystemContext` | ✅ |

**结论**：✅ **可实现**

`prependSystemContext` / `appendSystemContext` 由 API Provider 缓存，不需要 harness 层 memoization。

---

## 二、Fork-Join Cache（KV Cache 共享）

### Claude Code 实现

```typescript
// forkContextMessages — subagent 复用 parent 的 messages prefix
type CacheSafeParams = {
  systemPrompt: SystemPrompt      // 必须与 parent 相同
  tools: Tool[]                  // 必须相同
  model: string                  // 必须相同
  forkContextMessages: Message[]  // parent 消息前缀
}
```

### OpenClaw subagent spawn 参数

```typescript
// subagent-spawn.d.ts
export type SpawnSubagentParams = {
  task: string;           // subagent 的 prompt（完全由调用者控制）
  agentId?: string;
  model?: string;
  thinking?: string;
  runTimeoutSeconds?: number;
  mode?: "run" | "session";
  sandbox?: "inherit" | "require";
  // ⚠️ 没有 forkContextMessages 或任何继承 parent prompt prefix 的参数
};
```

**关键发现**：`spawnSubagentParams` **完全没有**任何继承或共享 parent prompt 的机制。

### 映射分析

| 条件 | Claude Code | OpenClaw |
|---|---|---|
| subagent prompt 可控 | ✅ | ✅ |
| subagent tools 可控 | ✅ | ✅ |
| subagent model 可控 | ✅ | ✅ |
| messages prefix 继承 | ✅ forkContextMessages | ❌ |
| API prompt cache 共享 | ✅ | ❌ |

**结论**：❌ **无法实现**

sessions 是完全独立的，没有 fork context 共享机制。

---

## 三、三层上下文压缩

### Claude Code 实现

```typescript
// compact.ts
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
```

- Layer 1: MEMORY.md（200行索引）
- Layer 2: topic files（按需加载）
- Layer 3: full transcript（可搜索）
- `compactWarningHook` — 提前警告
- `microCompact` — 轻度压缩
- Circuit breaker — 连续失败 3 次停止

### OpenClaw compaction 参数

```typescript
// compact.d.ts
export type CompactEmbeddedPiSessionParams = {
  sessionFile: string;
  currentTokenCount?: number;
  tokenBudget?: number;
  force?: boolean;
  trigger?: "budget" | "overflow" | "manual";
  // ...
};

// hooks.d.ts
export type PluginHookBeforeCompactionEvent = {
  messageCount: number;
  compactingCount?: number;
  tokenCount?: number;         // ✅ 有 token 计数
  messages?: unknown[];
  sessionFile: string;         // ✅ 完整 transcript 在磁盘
};

export type PluginHookAfterCompactionEvent = {
  messageCount: number;
  tokenCount?: number;
  compactedCount: number;       // ✅ 压缩了多少条
  sessionFile: string;
};
```

### OpenClaw 压缩功能

| 功能 | Claude Code | OpenClaw |
|---|---|---|
| 自动压缩 | ✅ | ✅ |
| token 计数 | ✅ | ✅ (`tokenCount` 参数) |
| `before_compaction` hook | ✅ | ✅ |
| `after_compaction` hook | ✅ | ✅ |
| sessionFile 路径 | ✅ | ✅ |
| `compactWarningHook` | ✅ | ❌ |
| `microCompact` | ✅ | ❌ |
| Circuit breaker | ✅ | ❌ |
| 不同 model compaction | ✅ | ✅ |

**结论**：⚠️ **部分可实现**
- ✅ 自动压缩、token 计数、before/after hooks 都有
- ❌ `compactWarningHook`（提前警告）— 没有
- ❌ `microCompact`（轻度压缩）— 只有全量
- ❌ Circuit breaker — 没有连续失败保护

---

## 四、工具权限级别

### Claude Code 实现

```typescript
// Tool 接口
type Tool = {
  name: string;
  allowedModes?: ToolAllowedModes[];  // 每个工具声明自己的权限级别
}

// 权限级别
type ToolAllowedModes = 
  | 'readonly'      // 只读
  | 'browser'      // 浏览器/网络
  | 'moderated'    // 需要审批
  | 'auto'         // 自动允许
  | 'open_world';  // 开放世界
```

### OpenClaw 工具类型

```typescript
// common.d.ts
export type AnyAgentTool = AgentTool<any, unknown> & {
  ownerOnly?: boolean;         // 仅 owner 可用
  displaySummary?: string;
};

export type AvailableTag = {
  id?: string;
  name: string;
  moderated?: boolean;  // 部分标记
};
```

### 映射分析

| 权限机制 | Claude Code | OpenClaw |
|---|---|---|
| 工具声明 allowedModes | ✅ | ❌ |
| ownerOnly | ❌ | ✅ |
| moderated 标记 | ❌ | ✅（部分） |
| 全局 allow/deny | ❌ | ✅ |
| 多 agent 模拟 | ❌ | ✅ |

**结论**：❌ **无法实现工具级别权限声明**

但可以通过多 agent 配置模拟：
- agent "readonly": `tools.allow=["read","glob","grep"]`
- agent "coding": `tools.allow=["read","write","exec"]`

---

## 五、AutoDream 记忆整合

### Claude Code 实现

```
Time gate (24h) → Session gate (5 sessions) → 获取锁 → Fork dream subagent
```

### OpenClaw subagent hooks

```typescript
// subagent_spawning — 可阻止或允许
export type PluginHookSubagentSpawningEvent = {
  childSessionKey: string;
  agentId: string;
  label?: string;
  mode: "run" | "session";
  // ...
};

export type PluginHookSubagentSpawningResult = 
  | { status: "ok"; threadBindingReady?: boolean; }
  | { status: "error"; error: string; }

// subagent_ended — 可清理
export type PluginHookSubagentEndedEvent = {
  targetSessionKey: string;
  targetKind: "subagent" | "acp";
  reason: string;
  outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
  // ...
};
```

### 映射分析

| 条件 | Claude Code | OpenClaw |
|---|---|---|
| Time gate | ✅ | ✅ (`cron`) |
| Session gate | ✅ | ✅ (`sessions_list`) |
| Lock（防止并发） | ✅ | ⚠️ 文件锁 |
| Fork subagent | ✅ | ✅ |
| Dream prompt | ✅ | ✅ |
| `subagent_spawning` hook | ❌ | ✅ |
| `subagent_ended` hook | ❌ | ✅ |

**结论**：✅ **可实现**

```javascript
// cron 定期检查 gates
// subagent_spawning 作为 lock（通过 status: "error" 阻止并发）
// sessions_spawn 运行 dream
// subagent_ended 清理
```

---

## 六、SessionMemory（周期性会话笔记）

### Claude Code 实现

```typescript
DEFAULT_SESSION_MEMORY_CONFIG = {
  minMinutesBetweenUpdates: 15,
  minTurnsBetweenUpdates: 5,
  tokenThreshold: 8000,
};
```

### OpenClaw 机制

- `HEARTBEAT.md` — 周期性检查清单
- `agent_end` hook — 会话结束时触发

**结论**：✅ **可实现**

---

## 七、ExtractMemories（查询结束提取）

### Claude Code 实现

- 查询结束（无 tool calls）→ Fork subagent → 提取记忆到 memory/

### OpenClaw agent_end hook

```typescript
export type PluginHookAgentEndEvent = {
  messages: unknown[];
  success: boolean;
  durationMs?: number;
  // 有 messages，可分析是否有 tool calls
};
```

**结论**：✅ **可实现**

---

## 八、AgentSummary（进度摘要）

### Claude Code 实现

- 每 30s 为 running subagent 生成 1-2 句进度摘要

### OpenClaw 机制

- `cron` — 定期触发
- `sessions_history` — 获取最近消息

**结论**：✅ **可实现**

---

## 九、PromptSuggestion（主动提示）

### Claude Code 实现

- Fork subagent 猜测用户可能想说的话

### OpenClaw 机制

- `HEARTBEAT.md` — 主动检查

**结论**：✅ **可实现**

---

## 十、MCP 动态注入

### Claude Code 实现

- `mcp_instructions` 是 `DANGEROUS_uncachedSystemPromptSection`
- 每次重算，确保 MCP 状态最新

### OpenClaw 机制

```typescript
// before_prompt_build
{
  event: "before_prompt_build",
  action: async (params) => {
    const mcpTools = await listMcpTools();
    return {
      prependSystemContext: mcpTools.length > 0
        ? `## MCP Servers\n${mcpTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}`
        : ""
    };
  }
}
```

**结论**：✅ **可实现**

---

## 总结对照表

### ✅ 可实现（不改源码）

| Pattern | OpenClaw 机制 | 难度 |
|---|---|---|
| 动态提示词 Section | `prependSystemContext`/`appendSystemContext` | 低 |
| AutoDream | `subagent_spawning` lock + cron + sessions_spawn | 中 |
| SessionMemory | `HEARTBEAT.md` + sessions_spawn | 低 |
| ExtractMemories | `agent_end` hook + sessions_spawn | 低 |
| Compaction hooks | `before_compaction` / `after_compaction` | 低 |
| AgentSummary | `cron` + `sessions_history` | 中 |
| PromptSuggestion | `HEARTBEAT.md` | 低 |
| MCP 动态注入 | `before_prompt_build` | 低 |
| Slash Commands | SKILL.md | 低 |
| 内置 Agent | SKILL.md + agent 配置 | 低 |
| 三层压缩 | `before_compaction`（部分） | 中 |

### ❌ 无法实现

| Pattern | 障碍 |
|---|---|
| Fork-Join Cache | sessions 完全独立，无 API cache 共享 |
| 工具权限级别声明 | 工具不声明 `allowedModes` |
| `compactWarningHook` | 没有"接近阈值提前警告"的 hook |
| `microCompact` | 只有全量压缩 |
| Circuit breaker | 没有连续失败保护 |

### ⚠️ 部分实现，需妥协

| Pattern | 妥协方案 |
|---|---|
| 三层压缩 | 只有全量压缩，无 microCompact |
| Circuit breaker | 无连续失败保护 |
| 工具权限级别 | 多 agent 配置模拟 |
| Fork-Join Cache | sessions_send 传递上下文（非 cache 共享） |

---

## OpenClaw 独有优势

OpenClaw 有以下 Claude Code **没有**的 hooks：

| Hook | 作用 |
|---|---|
| `before_model_resolve` | 模型解析前，可修改模型选择 |
| `llm_input` | LLM API 输入拦截 |
| `llm_output` | LLM API 输出拦截 |
| `before_agent_reply` | 可合成回复短路 LLM |
| `subagent_delivery_target` | 控制 subagent 路由目标 |
| `before_dispatch` | 消息分发前 |
| `before_install` | 可 block 安装 |
| `gateway_start/stop` | Gateway 生命周期 |
| `subagent_spawning/spawned/ended` | 完整 subagent 生命周期 |

---

## 建议优先级

```
P0（核心，必须）
├── 动态提示词 Section       — MCP/Skills/Slash commands 注入
├── ExtractMemories          — agent_end hook
├── SessionMemory            — HEARTBEAT.md
└── MCP 动态注入             — before_prompt_build

P1（重要，强烈建议）
├── AutoDream                — cron + subagent_spawning lock
├── Compaction hooks         — before/after compaction
└── 内置 Agent 定义          — SKILL.md

P2（增强，可选）
├── AgentSummary             — cron + sessions_history
├── PromptSuggestion         — HEARTBEAT.md
└── Slash Commands           — SKILL.md
```

---

## 参考文件路径

```
OpenClaw 源码：
/home/hhhh/.npm-global/lib/node_modules/openclaw/dist/

关键文件：
├── plugin-sdk/src/plugins/types.d.ts          — hook 类型定义
├── plugin-sdk/src/agents/subagent-spawn.d.ts — subagent spawn
├── plugin-sdk/src/agents/compact.d.ts        — compaction
├── plugin-sdk/src/agents/system-prompt.d.ts — system prompt
├── plugin-sdk/src/agents/tools/common.d.ts   — 工具类型
└── agent-sdk/src/agents/pi-embedded-runner/run/attempt.prompt-helpers.d.ts — prompt hook

官方文档：
├── concepts/agent-loop.md
├── concepts/system-prompt.md
├── concepts/compaction.md
└── tools/skills.md
```