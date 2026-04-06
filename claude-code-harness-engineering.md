# Claude Code Harness 工程实现全景文档

> 基于源码分析 + 网上公开技术解读
> 版本：claude-code-2.1.88（2026-03-31 npm 泄露）
> 源码路径：`/home/hhhh/claude-code-sourcemap-main/restored-src/src/`

---

## 一、核心架构：while(true) Loop

> "The core of Claude Code is a while(true) loop. Everything else is tooling around that loop."
> — Twitter/X 技术分析

```
用户消息
    ↓
[1] System Prompt 组装（Section 缓存）
    ↓
[2] processUserInput()
    ├── 解析 slash commands
    ├── 处理 attachments
    └── 返回 allowedTools / model
    ↓
[3] API 查询循环
    │     for await (message of query()) {
    │       ├── API 流式返回
    │       ├── tool_use → runTool()
    │       └── compact 检测
    │     }
    ↓
[4] recordTranscript() — 写入 transcript
    ↓
[5] accumulateUsage() — 更新 token 统计
    ↓
等待下一条消息 → back to [1]
```

---

## 二、工具系统实现

### 2.1 Tool 接口统一抽象

源码：`src/Tool.ts`

```typescript
type Tool = {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema
  allowedModes?: ToolAllowedModes[]   // ← 三层权限关键
  isEnabled?: () => boolean           // 动态启用/禁用
  isConcurrencySafe?: () => boolean
  isReadOnly?: () => boolean
  isOpenWorld?: () => boolean
  maxResultSizeChars?: number
  shouldDefer?: boolean
  execute(args, context: ToolUseContext): Promise<ToolResult>
}
```

### 2.2 工具分类（40+ 个）

| 类别 | 工具 | 权限级别 |
|---|---|---|
| 文件只读 | GlobTool, GrepTool, FileReadTool, LSPTool | `readonly` |
| 文件写 | FileEditTool, FileWriteTool, NotebookEditTool | `moderated` |
| 执行 | BashTool, PowerShellTool, REPLTool | `moderated` |
| Web | WebSearchTool, WebFetchTool, WebBrowserTool | `open_world` |
| Agent 协作 | AgentTool, SendMessageTool, TeamCreateTool | `moderated` |
| 系统 | MCPTool, SkillTool, ConfigTool | `moderated` |
| 主动模式 | BriefTool, SleepTool, ScheduleCronTool | `auto` |
| 特殊 | SyntheticOutputTool, TodoWriteTool | `auto` |

### 2.3 权限级别决定

每个 Tool 声明自己的 `allowedModes`，而非全局 allow/deny：

```typescript
// BashTool.ts
{
  name: 'Bash',
  allowedModes: ['live', 'streaming', 'monitor'],  // 需要审批
  isConcurrencySafe: () => false,                  // 不可并发
  isReadOnly: () => false,                         // 会修改状态
}

// FileReadTool.ts
{
  name: 'Read',
  allowedModes: ['readonly'],                      // 只读
  isReadOnly: () => true,
}
```

### 2.4 工具执行上下文

```typescript
type ToolUseContext = {
  abortController: AbortController
  cwd: string
  env: Record<string, string>
  getAppState: () => AppState
  setAppState: SetAppState
  mcpClients: MCPServerConnection[]
  getToolProgress: (toolUseId: string) => ToolProgressData | undefined
  handleElicitation?: (params) => Promise<ElicitResult>
}
```

---

## 三、Fork-Join 实现（KV Cache 共享）

源码：`src/utils/forkedAgent.ts`

### 3.1 API Prompt Cache 原理

```
Claude API 的 prompt cache 机制：
- 相同 prefix（system + tools + messages[:N]）→ 相同 KV cache key
- 变化的部分（messages[N+1:]）→ 增量计算
- cache_read 比重新计算便宜 90%+

实际测试数据：
- 无 cache：2M tokens × $3/MTok = $6.00
- 有 cache：1.84M cache_hit × $0.30/MTok + 0.16M cache_write × $3.75/MTok = $1.15
- 节省：81%
```

### 3.2 CacheSafeParams — 保证相同的钥匙

```typescript
type CacheSafeParams = {
  systemPrompt: SystemPrompt      // 必须与 parent 完全相同
  tools: Tool[]                  // 必须相同
  model: string                  // 必须相同
  thinkingConfig: ThinkingConfig // 必须相同
  forkContextMessages: Message[] // parent 的消息前缀
}
```

### 3.3 Fork 流程

```
主 Agent query
    ↓ fork
Subagent query
    ├── systemPrompt → 相同 ✅（CacheSafeParams 保证）
    ├── tools → 相同 ✅
    ├── model → 相同 ✅
    ├── messages[:N] → 相同 prefix ✅
    └── messages[N+1:] → subagent 独有
         ↓
         API 只计算差异部分
         cache hit prefix ≈ 90%
         节省 81% 成本
         TTFT 降低 5-10x
```

### 3.4 Fork 场景

| 场景 | 源码 | cache 共享 |
|---|---|---|
| ExtractMemories | `services/extractMemories/` | ✅ |
| SessionMemory | `services/SessionMemory/` | ✅ |
| AutoDream | `services/autoDream/` | ✅ |
| AgentSummary | `services/AgentSummary/` | ✅ |
| PromptSuggestion | `services/PromptSuggestion/` | ❌ skipCacheWrite |
| Compact | `services/compact/` | ❌ maxOutputTokens 不同 |

### 3.5 关键约束

```
fork 时必须保证：
1. systemPrompt 完全相同
2. tools 完全相同
3. model 完全相同
4. messages[:N] 前缀相同

→ 任一不同 → cache miss → 重新计算
```

---

## 四、动态提示词 Section 系统

源码：`src/constants/prompts.ts` + `src/constants/systemPromptSections.ts`

### 4.1 Section 类型

```typescript
// 可缓存 section（相同的 inputs → 相同输出）
const section = systemPromptSection(name, compute)
  → 结果 memoize
  → 下次调用直接返回缓存

// 不可缓存 section（每次必须重算）
const uncached = DANGEROUS_uncachedSystemPromptSection(name, compute, reason)
  → reason = "MCP servers can connect/disconnect mid-session"
```

### 4.2 Section 列表

| Section | 类型 | 说明 |
|---|---|---|
| `session_guidance` | memoized | slash commands 指南 |
| `memory` | memoized | MEMORY.md 内容 |
| `env_info_simple` | memoized | 工作目录、OS、时间 |
| `language` | memoized | 语言偏好 |
| `output_style` | memoized | 输出格式偏好 |
| `mcp_instructions` | **uncached** | MCP 服务器指令 |
| `hooks` | memoized | Hooks 说明 |
| `system_reminders` | memoized | 系统提醒 |
| `cyber_risk_instruction` | memoized | 网络安全 |
| `doing_tasks` | memoized | 任务执行指南 |
| `ant_model_override` | memoized | ant 模型覆盖 |

### 4.3 Prompt 组装流程

```typescript
// QueryEngine.submitMessage() 里：
const systemPrompt = asSystemPrompt([
  ...(customPrompt !== undefined ? [customPrompt] : defaultSystemPrompt),
  ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
  ...(appendSystemPrompt ? [appendSystemPrompt] : []),
])

// 主动模式注入
if (isProactiveActive()) {
  appendSystemPrompt += getProactiveSection()
}

// KAIROS 模式
if (kairosEnabled) {
  appendSystemPrompt += getAssistantSystemPromptAddendum()
}
```

### 4.4 MCP 为什么必须 uncached

```typescript
// mcp_instructions 是 DANGEROUS_uncachedSystemPromptSection
// 原因：
// 1. MCP 服务器在 session 中途可能连接或断开
// 2. 一旦 MCP 列表变化，工具集合也随之变化
// 3. 如果缓存了旧版本，新连接的 MCP 工具对 Agent 不可见
// 4. 每次重算确保 MCP 状态最新
```

---

## 五、三层上下文压缩

源码：`src/services/compact/compact.ts`（~1626 行）

### 5.1 三层内存设计

```
Layer 1: MEMORY.md（索引）
         ├── 最多 200 行 / 25KB
         ├── 包含其他 memory 文件的引用
         └── 每次会话开始加载

Layer 2: Topic Files（按需）
         ├── .claude/memories/ 下的主题文件
         ├── 特定项目/任务时才加载
         └── 需要时通过 memory_search 检索

Layer 3: Full Transcripts（可搜索）
         ├── 完整 session 记录
         ├── 压缩后仍可搜索
         └── 支持长期记忆回顾
```

### 5.2 压缩触发

```typescript
// compact.ts
AUTOCOMPACT_BUFFER_TOKENS = 13_000
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  return effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS
}
```

### 5.3 压缩算法

```typescript
async function* compactConversation(messages, params) {
  // 1. 分析上下文
  const { tokenCount, messageCount } = analyzeContext(messages)

  // 2. 计算需要压缩多少
  const { targetTokenCount, deltaTokenCount } = calculateCompressionTarget(
    tokenCount, contextWindow, MAX_OUTPUT_TOKENS_FOR_SUMMARY
  )

  // 3. 预处理：剥离图片/重复附件
  const stripped = stripReinjectedAttachments(messages)

  // 4. 构建压缩 prompt
  const compactPrompt = getCompactPrompt(stripped, deltaTokenCount)

  // 5. 发送到 API 生成摘要
  const summaryResponse = await queryModelWithStreaming(compactPrompt)

  // 6. 构建压缩后消息
  const compactedMessages = buildPostCompactMessages(
    originalMessages,
    summaryResponse,
    compactBoundaryIndex
  )

  // 7. 发送压缩边界标记
  yield {
    type: 'system',
    subtype: 'compact_boundary',
    compactMetadata: {
      originalMessageCount,
      compactedMessageCount,
      tokenSavings,
      preservedSegment,
    }
  }
}
```

### 5.4 关键常量

```typescript
POST_COMPACT_MAX_FILES_TO_RESTORE = 5
POST_COMPACT_TOKEN_BUDGET = 50_000        // 压缩后保留的 token 预算
POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000   // 每个文件最多保留
POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000
POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000
MAX_COMPACT_STREAMING_RETRIES = 2
```

### 5.5 失败保护

```typescript
// Circuit breaker
if (consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
  // 停止，报告错误
}

// PROMPT_TOO_LONG 降级
if (hitPTL) {
  truncateHeadForPTLRetry(messages)  // 从最旧消息开始丢弃 20%
  retry(max=3)
}
```

---

## 六、工具权限系统

源码：`src/types/permissions.ts`

### 6.1 权限模式

```typescript
type PermissionMode = 'auto' | 'ask' | 'bypassPermissions'
```

| 模式 | 行为 |
|---|---|
| `auto` | 安全操作自动批准，高风险操作要求确认 |
| `ask` | 每个操作都要求确认 |
| `bypassPermissions` | 跳过所有确认 |

### 6.2 权限检查流程

```typescript
wrappedCanUseTool(tool, input, context) {
  // 1. 检查工具的 allowedModes
  // 2. 检查路径限制（allowedPaths/deniedPaths）
  // 3. 检查 sandboxDirectory
  // 4. 检查 deny rule
  // 5. 记录 permissionDenials[]
}
```

### 6.3 Auto 模式分类器

```typescript
// TRANSCRIPT_CLASSIFIER 特性
// 使用 ML 模型学习历史行为，决定哪些操作可自动批准
// 而非静态规则
```

---

## 七、Hook 系统

源码：`src/types/hooks.ts` + `src/utils/hooks.ts`（4923 行）

### 7.1 25 个生命周期钩子

```
消息层：
  message_received → message_sending → message_sent

Agent 循环层：
  before_prompt_build → before_agent_start → agent_end

工具层：
  before_tool_call → after_tool_call → PostToolUseFailure

Session 层：
  session_start → session_end

Compact 层：
  before_compact → after_compact

子 Agent 层：
  SubagentStart → SubagentStop

命令层：
  PreCommand → PostCommand

其他：
  Setup, CwdChanged, FileChanged, InstructionsLoaded,
  PromptSubmission, UserIntent, Idle, Wake
```

### 7.2 Hook 响应类型

```typescript
// Sync hook
{
  continue?: boolean,        // 是否继续（默认 true）
  suppressOutput?: boolean,  // 隐藏 stdout
  block?: boolean,           // 阻止（终止性）
  stopReason?: string,
  decision?: 'approve' | 'block',
  reason?: string,
  systemMessage?: string
}

// Async hook
{
  continue?: boolean,
  hookSpecificOutput?: {...}
}
```

### 7.3 block 语义

```
before_tool_call: { block: true }  → 终止，不执行工具
before_tool_call: { block: false } → no-op，不清除之前的 block

before_install: { block: true }   → 终止
before_install: { block: false } → no-op

message_sending: { cancel: true } → 终止，不发送
message_sending: { cancel: false } → no-op
```

---

## 八、Agent 生命周期（runAgent）

源码：`src/tools/AgentTool/runAgent.ts`（~900 行）

### 8.1 完整生命周期

```typescript
async function* runAgent(params) {
  // ===== BEFORE =====
  const fileState = cloneFileStateCache(parent)    // 隔离文件缓存
  const abortCtrl = new AbortController()        // 隔离中断控制

  const { clients, tools: agentMcpTools, cleanup } =
    await initializeAgentMcpServers(agentDefinition, parentClients)

  registerFrontmatterHooks(agentDefinition, agentId)

  const skillsToPreload = agentDefinition.skills ?? []

  const context = createSubagentContext(parent, {
    abortController: abortCtrl,
    readFileState: fileState,
    mcpClients: clients,
    tools: mergedTools,
  })

  // ===== CORE =====
  try {
    for await (const msg of query(context)) {
      yield msg
    }
  }

  // ===== AFTER（finally）=====
  finally {
    await mcpCleanup()                      // 清理 MCP
    clearSessionHooks(agentId)              // 清除 hooks
    agentReadFileState.clear()             // 清理文件缓存
    killShellTasksForAgent(agentId)        // 终止 shell 任务
    rootSetAppState(prev => ({ ...prev, todos: [] }))  // 清理 todos
  }
}
```

### 8.2 状态隔离层级

| 状态 | 隔离方式 |
|---|---|
| 文件缓存 | `cloneFileStateCache()` — 独立 LRU 副本 |
| AbortController | `new AbortController()` — 独立中断 |
| MCP clients | 叠加（parent + agent 私有） |
| Skills | agent 级别预加载 |
| Hooks | agent 绑定的 hooks 独立注册 |
| mutableMessages | fork 时传入 `forkContextMessages` 前缀 |

---

## 九、AutoDream 记忆整合

源码：`src/services/autoDream/autoDream.ts`

### 9.1 触发条件（Gate 检查，从最便宜到最贵）

```typescript
checkGates() {
  // Gate 1: 时间（最便宜，先检查）
  if (hoursSinceLastDream < 24) return false

  // Gate 2: Session 数量
  if (transcriptCount < 5) return false

  // Gate 3: 锁（防止并发整合）
  if (isConsolidationRunning()) return false
}
```

### 9.2 整合流程

```
1. 获取整合锁（prevent concurrent consolidation）
2. 收集累积上下文（sessions + memories）
3. Fork subagent 运行 dream prompt
   → "你已经有一段时间没有整合知识了..."
   → 模型深度思考和知识整合
4. 写入 MEMORY.md 和 topic files
5. 释放锁
```

### 9.3 SessionMemory（周期性会话笔记）

```typescript
// services/SessionMemory/
DEFAULT_SESSION_MEMORY_CONFIG = {
  minMinutesBetweenUpdates: 15,   // 至少 15 分钟
  minTurnsBetweenUpdates: 5,      // 至少 5 轮对话
  tokenThreshold: 8000,           // token 超过 8000 才触发
}

// 通过 postSamplingHooks 注册（不阻塞主循环）
// Fork agent 生成 markdown 笔记
// 写入 ~/.claude/sessions/<sessionId>/memory.md
```

### 9.4 ExtractMemories（查询结束提取）

```typescript
// services/extractMemories/
// 在每个查询结束时（无 tool calls 的 final response）
// Fork subagent 提取持久记忆
// 写入 ~/.claude/projects/<path>/memory/
```

---

## 十、API 层与错误处理

源码：`src/services/api/`

### 10.1 API 请求封装

```typescript
// query.ts — AsyncGenerator 实现
async function* queryLoop(params) {
  for (;;) {
    const apiParams = buildApiParams(state)

    for await (const event of apiStream) {
      switch (event.type) {
        case 'message_start': ...
        case 'content_block_start': ...
        case 'content_block_delta': ...
        case 'message_delta': ...
        case 'message_stop': ...
      }
    }

    // 处理工具调用
    if (hasToolUses) {
      // 执行工具 → 继续循环
    }

    // 处理停止原因
    switch (stopReason) {
      case 'end_turn': return
      case 'max_tokens': // 尝试恢复
      case 'tool_use': // 继续
    }
  }
}
```

### 10.2 重试策略

```typescript
// withRetry.ts
// 429 Rate Limit → 指数退避重试
// PROMPT_TOO_LONG → compact 或降级
// context overflow → 压缩
```

---

## 十一、工程实现的 5 个核心原则

```
1. Cache First（缓存优先）
   → Section memoization
   → Fork-safe cache 共享
   → 相同的东西不算第二遍

2. Incremental（增量计算）
   → uncached section 只重算变化的部分
   → MCP 连接/断开 → 只影响 1 个 Section

3. Layered（分层设计）
   → Memory 三层：index → topic → transcript
   → 工具三层：readonly → moderated → browser
   → Hook 三层：pre → post → failure

4. Graceful Degradation（优雅降级）
   → Circuit breaker（连续失败 3 次停止）
   → PROMPT_TOO_LONG → 降级重试
   → compact 失败 → 报告而非崩溃

5. Observable（可观测）
   → 25 个 hook 点
   → 完整的事件追踪
   → token 使用量透明
```

---

## 十二、核心代码量统计

| 模块 | 文件 | 估计行数 |
|---|---|---|
| Tool 系统 | `Tool.ts` + `tools.ts` + `tools/*/` | ~20,000 |
| QueryEngine + query | `QueryEngine.ts` + `query.ts` | ~3,300 |
| Fork-Join Cache | `forkedAgent.ts` | ~500 |
| 动态提示词 | `prompts.ts` + `systemPromptSections.ts` | ~2,000 |
| 三层压缩 | `compact/` | ~1,626 |
| Hook 系统 | `types/hooks.ts` + `utils/hooks.ts` | ~4,923 |
| runAgent | `runAgent.ts` | ~900 |
| AutoDream | `autoDream.ts` + `SessionMemory/` + `extractMemories/` | ~2,000 |
| 权限系统 | `types/permissions.ts` | ~500 |
| **核心 harness 合计** | | **~35,000 行** |

---

## 十三、OpenClaw 对比与进化建议

### 13.1 已有的能力

| Claude Code | OpenClaw | 状态 |
|---|---|---|
| while(true) loop | `runEmbeddedPiAgent` | ✅ 等价 |
| 40+ 工具 | 核心工具集 | ✅ 部分满足 |
| Tool 接口 | Skills SKILL.md | ✅ 等价 |
| Hook 系统 | 大部分 hook 已支持 | ✅ |
| 记忆系统 | MEMORY.md + memory_search | ✅ |
| ACP 协议 | `sessions_spawn/send` | ✅ |
| MCP 支持 | `mcp_*` tools | ✅ |

### 13.2 需要增强的能力

| 功能 | 优先级 | 实现方式 |
|---|---|---|
| Fork-Join Cache | ⭐⭐⭐ | sessions_spawn 增强：保证 prompt prefix 相同 |
| 动态提示词 Section | ⭐⭐⭐ | `before_prompt_build` hook 缓存机制 |
| 三层上下文压缩 | ⭐⭐⭐ | `before_compaction` hook + 摘要生成 |
| 工具权限级别 | ⭐⭐ | 每个工具声明 allowedModes |
| AutoDream | ⭐⭐ | cron + lock + dream prompt |
| SessionMemory | ⭐⭐ | HEARTBEAT.md + sessions_spawn |

### 13.3 进化路径

```
第一步：Fork-Join Cache（影响力最大）
  → sessions_spawn 增加 cacheSafeParams 选项
  → 保证 subagent 的 system prompt 与 parent 相同
  → 节省 80%+ API 成本

第二步：动态提示词 Section
  → 实现 Section memoization 缓存
  → MCP 变化只重算 1 个 Section

第三步：三层上下文压缩
  → 实现 token 计数
  → 实现基于理解的摘要压缩
  → 不只是截断

第四步：工具权限级别
  → 每个工具声明自己的 allowedModes
  → 精细化权限控制

第五步：AutoDream + SessionMemory
  → 周期性后台整合
```

---

## 十四、参考来源

- VentureBeat: "Claude Code's source code appears to have leaked"
- Ken Huang (Substack): "The Claude Code Leak: 10 Agentic AI Harness Patterns"
- Paddy / paddo.dev: "What the Harness Actually Looks Like"
- Hugging Face Forums: "Claude Code Source Leak: Production AI Architecture Patterns"
- Latent.Space AINews
- SuperFrameworks: "What 512K Lines Reveal About the Best AI Coding Harness"
- Claude Code Camp: "How Prompt Caching Actually Works in Claude Code"
- LLMCache Blog: "Context Engineering & Reuse Pattern Under the Hood of Claude Code"
- 源码：`/home/hhhh/claude-code-sourcemap-main/restored-src/src/`