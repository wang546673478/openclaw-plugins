# Claude Code 功能 → OpenClaw 实现映射文档

> 对比 Claude Code 功能与 OpenClaw 现有 extension points，识别无需修改 OpenClaw 源码即可实现的功能
> 基于 Claude Code 源码与 OpenClaw 官方文档

---

## 一、映射总览

```
可实现程度：
✅ 完全可实现    — OpenClaw 已有等价功能或直接可组合实现
⚠️ 部分可实现    — 核心可实现，但细节有差距
❌ 需修改源码    — 需要 OpenClaw 底层支持
🆕 需新开功能    — OpenClaw 完全缺失该功能
```

---

## 二、【A】Agent Harness Core

### A.1 QueryEngine / 主循环

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| AsyncGenerator 流式输出 | OpenClaw 的 `agent` RPC 已有 streaming events | ✅ |
| submitMessage 主入口 | `runEmbeddedPiAgent` = 等价 | ✅ |
| recordTranscript | 自动写入 `sessions/*.jsonl` | ✅ |
| compact 检测 | `before_compaction` / `after_compaction` hooks | ✅ |
| wrappedCanUseTool 权限追踪 | `tools.allow/deny` + `before_tool_call` hook | ✅ |

**实现方案**：
```javascript
// hooks 实现权限追踪
{
  name: "permission-tracker",
  event: "before_tool_call",
  action: (params) => {
    logToolUse(params.tool, params.args)
    if (params.tool === "exec" && matchesDenied(params.args)) {
      return { block: true, reason: "Denied pattern" }
    }
    return { continue: true }
  }
}
```

---

### A.2 Tool 系统

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 40+ 内置工具 | OpenClaw 已有等价的 `exec/read/write/edit/browser/web_search` 等 | ✅ |
| Tool 基类 + execute() | Skills 的 SKILL.md 格式 | ✅ |
| 工具条件编译 (feature) | Skills 的 `metadata.openclaw.requires` | ✅ |
| 工具权限上下文 | `tools.allow/deny/profile` | ✅ |
| `apply_patch` 多 hunk | OpenClaw 内置 `apply_patch` tool | ✅ |
| REPLTool | `exec` tool | ✅ |
| NotebookEdit | 暂无（需新开） | 🆕 |
| LSPTool | 暂无 | 🆕 |
| PowerShellTool | `exec` + PowerShell 本身 | ⚠️ |

---

### A.3 Task 系统

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 7 种任务类型 | `sessions_spawn` 可覆盖 local_agent / remote_agent / in_process | ✅ |
| Task ID 生成 | OpenClaw session ID 机制 | ✅ |
| 任务输出持久化 | `sessions/<sessionId>/tasks/` | ✅ |
| main-session 后台任务 | `sessions_spawn` 后台运行 | ✅ |
| 任务 kill/abort | `sessions_kill` 或 `sessions_yield` | ✅ |

---

### A.4 Subagent Framework（runAgent）

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 子 Agent 生命周期 | `sessions_spawn` + `sessions_send` | ✅ |
| 状态隔离 | `sessions` 天然隔离 | ✅ |
| frontmatter hooks 注册 | OpenClaw hooks | ✅ |
| fork-safe cache | `sessions_spawn` 共享 prompt 前缀（需验证） | ⚠️ |
| agent 专属 MCP | OpenClaw 的 `mcp` tool | ✅ |
| skills 预加载 | `skills/` 目录 | ✅ |
| 清理（finally 块） | OpenClaw 自动清理 | ✅ |

---

### A.5 内置 Agent 定义

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| builtInAgents.ts | Skills 目录 + SKILL.md | ✅ |
| AgentDefinition 结构 | Skills 的 frontmatter metadata | ✅ |
| agentType / whenToUse | SKILL.md 的 `name` / `description` | ✅ |
| 工具列表限制 | Skills 不控制工具（需通过 tools.allow/deny） | ⚠️ |
| 自定义 system prompt | SKILL.md 内容 | ✅ |
| maxTurns | `sessions_spawn` 的 timeout 控制 | ⚠️ |
| permissionMode | `tools.exec.approvals` | ✅ |
| 内置 Explore Agent | `skills/explore/SKILL.md` | ✅ |
| 内置 Plan Agent | `skills/plan/SKILL.md` | ✅ |
| 内置 Verification Agent | `skills/verification/SKILL.md` | ✅ |

**实现方案**：
```markdown
<!-- skills/explore/SKILL.md -->
---
name: explore-agent
description: Use when you need to search and read files without modifying anything.
metadata: { "openclaw": { "requires": {} } }
---

# Explore Agent

You are a file search specialist. You help users explore codebases.

## CRITICAL: READ-ONLY MODE
You are STRICTLY PROHIBITED from:
- Creating new files
- Modifying existing files
- Running commands that modify state
- Deleting anything

## Available Tools
- read, glob, grep, web_fetch, web_search
```

---

## 三、【B】Agent Memory & Context

### B.1 memdir / MEMORY.md

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| MEMORY.md 加载 | `MEMORY.md` 相同 | ✅ |
| memory 类型（episodic/semantic/working） | `memory/` 目录 + frontmatter 类型 | ⚠️ |
| 截断逻辑（200行/25KB） | 需自定义 logic | ⚠️ |
| ENTRYPOINT_NAME | `MEMORY.md` | ✅ |
| types section | 需手动写入 MEMORY.md | ✅ |

---

### B.2 Compact 系统

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 自动压缩触发 | `before_compaction` hook | ✅ |
| 阈值计算 | 需自定义 logic | ⚠️ |
| 压缩摘要生成 | OpenClaw 内置（Pi agent core） | ✅ |
| compactWarningHook | `before_compaction` hook 可实现警告 | ✅ |
| microCompact | 需自定义 | ⚠️ |
| Circuit breaker | 需自定义（hook 内实现） | ⚠️ |
| Delta attachment | OpenClaw 压缩结果直接生效 | ✅ |

**实现方案**：
```javascript
// skills/compact-warning/SKILL.md 或 hook
{
  name: "compact-warning",
  event: "before_compaction",
  action: async (params) => {
    const usage = await getSessionUsage(params.sessionId)
    const contextWindow = getModelContextWindow(params.model)
    const remaining = contextWindow - usage.total
    
    if (remaining < 20_000) {
      await sendWarningToUser(params.sessionId, 
        `Context at ${Math.round(remaining/contextWindow*100)}%`)
    }
    return { continue: true }
  }
}
```

---

### B.3 SessionMemory（周期性后台笔记）

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 周期性触发（15min/5轮） | `HEARTBEAT.md` 定时检查 | ✅ |
| Fork agent 生成笔记 | `sessions_spawn` | ✅ |
| 写入 session memory.md | `memory/` 目录 | ✅ |
| Token 阈值触发 | HEARTBEAT.md 内逻辑 | ✅ |

**实现方案**：
```markdown
<!-- HEARTBEAT.md -->
<!-- 每15分钟检查一次 -->
<!-- 如果 token 使用量 > 8000，运行一个 silent session 生成笔记 -->
```

---

### B.4 ExtractMemories

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 查询结束时提取 | `agent_end` hook | ✅ |
| fork agent 运行 | `sessions_spawn` | ✅ |
| 写入 projects/<path>/memory/ | `memory/` 目录 | ✅ |
| 提取 prompt | 自定义 skill | ⚠️ |

**实现方案**：
```javascript
{
  name: "extract-memories",
  event: "agent_end",
  action: async (params) => {
    if (params.hasToolCalls) return  // 只有无 tool calls 才提取
    await sessions_spawn({
      task: "extract-memory",
      prompt: `从以下对话提取关键信息...\n${params.messages.slice(-10)}`
    })
  }
}
```

---

### B.5 AutoDream

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| Time gate（24h） | `cron` tool | ✅ |
| Session gate（5 sessions） | `sessions_list` + 计数 | ✅ |
| Consolidation lock | 需自己实现锁（file lock） | ⚠️ |
| Dream prompt | 自定义 skill | ✅ |

**实现方案**：
```javascript
// skills/auto-dream/SKILL.md
// 通过 cron 定期检查：
// 1. hoursSinceLast >= 24
// 2. sessionCount >= 5
// 3. 获取锁
// 4. sessions_spawn 运行 dream prompt
```

---

### B.6 Token 计数

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| roughTokenCountEstimation | 需实现估算算法 | ⚠️ |
| 按消息来源统计 | `session_status` 返回 usage | ✅ |
| 重复文件读取检测 | 需自定义 logic | ⚠️ |
| 上下文百分比显示 | `session_status` 可获取 | ✅ |

---

## 四、【C】Agent Collaboration

### C.1 Coordinator 模式

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 多 Agent 协调 | `sessions_spawn` + `sessions_send` | ✅ |
| 工具过滤 | `tools.allow/deny` per agent | ✅ |
| Scratchpad 通信 | `sessions_send` + `memory/` | ✅ |
| getCoordinatorUserContext | 自定义 skill | ⚠️ |

**实现方案**：
```javascript
// skills/coordinator/SKILL.md
// 主 Agent 作为协调者：
// - 使用 AgentTool spawn subagent
// - 使用 SendMessageTool 传递消息
// - 控制工具访问 via tools.allow/deny
```

---

### C.2 SendMessageTool

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| Agent 间消息 | `sessions_send` | ✅ |
| 消息类型（task/result/handoff/stop） | 自定义格式 | ✅ |
| 消息路由 | `sessions_send(targetSessionId)` | ✅ |

---

### C.3 AgentSummary

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 每30s生成进度摘要 | `cron` + `sessions_history` | ⚠️ |
| 1-2句进度描述 | 自定义 skill | ⚠️ |

---

### C.4 PromptSuggestion

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 猜测用户意图 | 自定义 skill（主动模式） | ⚠️ |
| chomp inflection | `HEARTBEAT.md` 主动检查 | ⚠️ |

---

## 五、【D】System Infrastructure

### D.1 Hook 系统

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 25 个 hook 事件 | OpenClaw 的 hooks 覆盖大部分 | ✅ |
| `PreToolUse` | `before_tool_call` | ✅ |
| `PostToolUse` | `after_tool_call` | ✅ |
| `PreAgentStart` | `before_agent_start` | ✅ |
| `SubagentStart/Stop` | `session_start/end` | ✅ |
| `PreCompact` | `before_compaction` | ✅ |
| `SessionStart/End` | `session_start/end` | ✅ |
| `Idle/Wake` | 无直接等价 | ❌ |
| `PreCommand/PostCommand` | 无直接等价 | ❌ |
| `PrePromptBuild` | `before_prompt_build` | ✅ |

---

### D.2 MCP 客户端

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| MCP 工具封装 | OpenClaw 内置 `mcp_*` tools | ✅ |
| OAuth 支持 | OpenClaw MCP 配置 | ✅ |
| Session 过期重连 | OpenClaw MCP 自动重连 | ✅ |
| 工具描述限制 2048 | 无直接等价（但无害） | ✅ |
| 官方 MCP 服务器列表 | 需手动配置 | ⚠️ |

---

### D.3 Analytics

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| GrowthBook 特性开关 | 无直接等价 | ❌ |
| 事件日志 | `before_tool_call` / `after_tool_call` 自己记录 | ⚠️ |
| Datadog 集成 | 无直接等价 | ❌ |
| 工具使用排行 | `sessions_history` + 自定义统计 | ⚠️ |

**实现方案**：
```javascript
// skills/analytics/SKILL.md
// 收集工具调用：
// - before_tool_call: 记录 tool name + args
// - session_end: 汇总写入 analytics.jsonl
// CLI: openclaw analytics summary --days 7
```

---

### D.4 Cost Tracker

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| Token 使用量 | `session_status` | ✅ |
| 成本计算 | `session_status` + provider API | ✅ |
| API Duration | `session_status` | ✅ |

---

## 六、【E】CLI Interface

### E.1 内置命令

| Claude Code 命令 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| `/commit` | 自定义 skill | ⚠️ |
| `/diff` | 自定义 skill | ⚠️ |
| `/review` | 自定义 skill | ⚠️ |
| `/test` | 自定义 skill | ⚠️ |
| `/plan` | 自定义 skill | ⚠️ |
| `/btw` | 自定义 skill | ⚠️ |
| `/compact` | OpenClaw 内置 | ✅ |
| `/memory` | `memory_search` | ✅ |
| `/resume` | `sessions_send` | ✅ |
| `/new` | `sessions_spawn` | ✅ |

**实现方案**：
```markdown
<!-- skills/command-commit/SKILL.md -->
---
name: command-commit
description: Commit current changes to git
user-invocable: true
metadata: { "openclaw": { "command-dispatch": "tool", "command-tool": "exec" } }
---
# /commit

当用户想提交代码时使用此技能。

运行: git add -A && git commit -m "<用户输入的消息>"
```

---

### E.2 CLI 子命令

| Claude Code | OpenClaw |
|---|---|
| `claude mcp list/start/stop` | `openclaw mcp list/start/stop` | ✅ |
| `claude agents list/add/remove` | `openclaw agents add/list` | ✅ |
| `claude login/logout` | `openclaw channels login` | ✅ |
| `claude config` | `openclaw setup` | ✅ |
| `claude doctor` | `openclaw doctor` | ✅ |

---

## 七、【F】Bridge / Remote

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| RemoteSessionManager | ACP protocol | ⚠️ |
| 桥接模式 | `gateway remote` | ✅ |
| Direct Connect | Tailscale / SSH tunnel | ✅ |
| Trusted Device | pairing 系统 | ✅ |

---

## 八、【G】UI Layer

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| Ink React UI | Web Control UI | ⚠️ |
| Block Streaming | OpenClaw streaming | ✅ |
| Preview Streaming | `channels.*.streaming` | ✅ |
| Human-like Pacing | `humanDelay` | ✅ |
| 状态栏 | Web UI | ✅ |

---

## 九、【H】Platform Integrations

### H.1 Buddy（虚拟宠物）

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| ASCII Sprite 动画 | 无等价 | ❌ |
| 物种/属性/稀有度 | 无等价 | ❌ |
| 状态通知 | Web UI notification | ⚠️ |

---

### H.2 Voice

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| 语音输入 | iOS/Android node voice | ✅ |
| TTS 输出 | `sag` tool | ✅ |
| 关键词检测 | 自定义 skill | ⚠️ |

---

## 十、【I】Skills System

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| SKILL.md 格式 | 完全兼容 | ✅ |
| 内置技能 | `skills/bundled/` | ✅ |
| 条件加载（bins/env/config） | `metadata.openclaw.requires` | ✅ |
| ClawHub | clawhub.com | ✅ |
| Skill 优先级 | 相同（workspace wins） | ✅ |

---

## 十一、【J】Utils

| Claude Code 功能 | OpenClaw 实现方式 | 程度 |
|---|---|---|
| FileStateCache LRU | OpenClaw 内部处理 | ✅ |
| Permissions 系统 | `tools.allow/deny` | ✅ |
| Thinking 配置 | OpenClaw 内置 | ✅ |

---

## 十二、总结：可实现性一览

### ✅ 完全可实现（20 项）

```
- AsyncGenerator 流式（OpenClaw streaming events）
- 内置工具（read/write/exec/browser 等已有）
- Task 系统（sessions_spawn/send/kill）
- Subagent 生命周期（sessions_spawn）
- 内置 Agent 定义（Skills）
- MEMORY.md 系统
- Compact 触发（before/after_compaction hooks）
- SessionMemory（HEARTBEAT.md + sessions_spawn）
- ExtractMemories（agent_end hook + sessions_spawn）
- AutoDream（cron + sessions_spawn）
- Coordinator 模式（sessions_spawn + sessions_send）
- SendMessageTool（sessions_send）
- Hook 系统（OpenClaw hooks）
- MCP 工具（mcp_* tools）
- Cost Tracker（session_status）
- CLI 子命令（openclaw mcp/agents/channels）
- Block/Preview Streaming（内置）
- Skills 系统（完全兼容）
- 权限模型（tools.allow/deny）
- ACP Remote
```

### ⚠️ 部分可实现（16 项）

```
- 工具权限上下文（tools.allow/deny 可覆盖大部分）
- memory 类型系统（需 frontmatter 约定）
- Token 计数（需自定义估算）
- microCompact / Circuit breaker（hook 内实现）
- HEARTBEAT.md 主动模式（可模拟 Periodic checks）
- Slash Commands（需自定义 skill）
- Analytics 收集（hook 内记录 + CLI 汇总）
- RemoteSessionManager（ACP 等价但不完全相同）
- Voice 关键词检测（自定义 skill）
- Built-in Agent 工具限制（需 tools.allow/deny 配合）
- MCP 官方服务器列表（需手动配置）
- Human-like Pacing（部分等价）
- AgentSummary（需 cron + sessions_history）
- PromptSuggestion（需自定义 proactive skill）
- UDS Inbox（ACP 消息队列部分等价）
- Dream prompt（自定义 skill）
```

### ❌ 需修改源码（7 项）

```
- Ink React UI（OpenClaw 使用 Web UI）
- GrowthBook 特性开关
- Datadog 遥测集成
- Companion/Sprite 虚拟宠物系统
- FileStateCache LRU 精确控制
- `PreCommand`/`PostCommand` hook
- `Idle`/`Wake` hook
```

### 🆕 需新开功能（3 项）

```
- NotebookEdit tool（Jupyter 支持）
- LSP tool（Language Server Protocol）
- Embedded search tools（代码库索引）
```

---

## 十三、优先级实现路径

### 第一批（直接可用，无需开发）

```
1. 内置 Agent 定义（Explore/Plan/Verification）
   → 创建 skills/explore/SKILL.md 等
   → 立即可用

2. Slash Commands（commit/diff/review/test）
   → 每个创建 1 个 SKILL.md
   → 立即可用

3. Analytics 收集
   → hooks 记录 tool_call
   → CLI 汇总统计
   → 立即可用

4. AutoDream
   → cron skill + dream prompt
   → 1-2 小时完成
```

### 第二批（需要组合）

```
5. SessionMemory
   → HEARTBEAT.md + sessions_spawn
   → ~半天

6. ExtractMemories
   → agent_end hook + sessions_spawn
   → ~半天

7. Compact Warning
   → before_compaction hook
   → ~1 小时

8. Coordinator 模式
   → sessions_spawn + sessions_send
   → ~1 天
```

### 第三批（需要较多开发）

```
9. Token 计数系统
   → 自定义估算 + 显示
   → ~1 天

10. PromptSuggestion
    → proactive HEARTBEAT.md
    → ~1 天

11. Analytics Dashboard
    → Web UI 或 CLI
    → ~2 天
```

---

## 十四、核心结论

**OpenClaw 的 extension points 覆盖了 Claude Code 80%+ 的功能**。

最关键的优势：
1. **Skills 系统**完全兼容 AgentSkills 格式，Agent 定义直接可移植
2. **Hooks 系统**覆盖了主要生命周期事件
3. **sessions_spawn/send** 组合可实现 subagent 协作
4. **HEARTBEAT.md** 可模拟 SessionMemory / AutoDream 的周期性检查
5. **ACP 协议**提供了 agent 间通信的基础

最大的差距：
1. **GrowthBook** 特性开关（数据驱动产品决策）
2. **Compact 系统**的精确控制（阈值/circuit breaker）
3. **Companion 虚拟宠物**（纯体验功能）
4. **Notebook/LSP** 工具（专业功能）