# 【A】Agent Harness Core — 核心模块详细文档

> 模块划分：Claude Code 十大功能模块之一
> 包含：QueryEngine、query、Task、Tool、tools、tools/、entrypoints/sdk/

---

## A.1 整体架构

```
QueryEngine ← 核心调度者
  │
  ├── submitMessage()      ← 主入口，AsyncGenerator
  │     │
  │     ├── fetchSystemPromptParts()     → System Prompt 组装
  │     ├── processUserInput()            → Slash command 解析
  │     ├── recordTranscript()            → 写入 transcript
  │     │
  │     └── for await (message of query()) ← API 查询循环
  │           │
  │           ├── StreamEvent.yield      → 返回给调用者
  │           ├── tool_use → runTool()   → 执行工具
  │           └── compact 检测            → 自动压缩
  │
  ├── tools.ts             → 40+ 工具注册表
  ├── tools/               → 各工具实现
  ├── Task.ts / tasks.ts   → 任务抽象与类型
  └── tasks/               → 任务实现（LocalShell/LocalAgent等）
```

**核心关系**：
- `QueryEngine` 是**调度者**，持有 `mutableMessages`、`readFileState`、`totalUsage` 等状态
- `query()` 是**API 查询循环**，yield StreamEvent
- `Tool` 是**工具抽象**，每个工具实现 `execute()`
- `Task` 是**任务抽象**，代表一个执行单位

---

## A.2 QueryEngine — 主查询引擎

源码：`QueryEngine.ts`（~1300 行）

### A.2.1 构造与状态

```typescript
class QueryEngine {
  private config: QueryEngineConfig     // 构造时注入，不可变
  private mutableMessages: Message[]     // 会话消息历史，可变
  private abortController: AbortController
  private permissionDenials: SDKPermissionDenial[]
  private totalUsage: NonNullableUsage  // 累计 API 使用量
  private readFileState: FileStateCache  // LRU 文件缓存
  private discoveredSkillNames = new Set<string>()
  private loadedNestedMemoryPaths = new Set<string>()
}
```

### A.2.2 submitMessage — 主入口

```typescript
async *submitMessage(
  prompt: string | ContentBlockParam[],
  options?: { uuid?: string; isMeta?: boolean }
): AsyncGenerator<SDKMessage, void, unknown>
```

**完整流程**：

```
1. 初始化
   ├── this.discoveredSkillNames.clear()
   ├── 创建 wrappedCanUseTool()（包装权限追踪）
   └── 获取 initialAppState / initialMainLoopModel

2. System Prompt 组装
   ├── fetchSystemPromptParts()
   │     ├── defaultSystemPrompt
   │     ├── userContext
   │     └── systemContext
   ├── loadMemoryPrompt()（如果设置了 CLAUDE_COWORK_MEMORY_PATH_OVERRIDE）
   └── asSystemPrompt([...])

3. processUserInput()
   ├── 解析 slash commands
   ├── 处理 attachments
   └── 返回 { messagesFromUserInput, shouldQuery, allowedTools, model, resultText }

4. 写入 Transcript（API 调用前）
   └── recordTranscript(messages) — 确保 kill-mid-request 可恢复

5. 如果 shouldQuery === false
   └── 只执行本地 slash commands，返回 result

6. API 查询循环
   └── for await (message of query()) { yield message }

7. 工具执行结果处理
   ├── runTools() → 执行工具
   ├── 追加到 mutableMessages
   └── 继续 query() 循环

8. 统计更新
   ├── accumulateUsage()
   ├── recordTranscript()
   └── 返回最终 result
```

### A.2.3 yield 的消息类型

```typescript
// SDKMessage 的类型：
type SDKMessage =
  | { type: 'result', ... }           // 最终结果
  | { type: 'user', ... }             // 用户消息 replay
  | SDKCompactBoundaryMessage           // 压缩边界
  | AssistantMessage                    // Assistant 回复
  | ProgressMessage                    // 进度
  | SystemMessage                     // 系统消息
```

---

## A.3 query — API 查询循环

源码：`query.ts`（~2000 行）

### A.3.1 query() 主循环

```typescript
async function* queryLoop(params): AsyncGenerator<StreamEvent | Message> {
  let state: State = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    autoCompactTracking: undefined,
    maxOutputTokensRecoveryCount: 0,
    hasAttemptedReactiveCompact: false,
    turnCount: 1,
    pendingToolUseSummary: undefined,
    stopHookActive: undefined,
    transition: undefined,
  }

  // 循环直到 terminal 状态
  for (;;) {
    // 1. 构建 API 请求配置
    const apiParams = buildApiParams(state)

    // 2. 发送 API 请求，流式处理
    for await (const event of apiStream) {
      switch (event.type) {
        case 'message_start':
          // 新消息开始，重置 usage
        case 'content_block_start':
          // 内容块开始
        case 'content_block_delta':
          // 内容块增量（text / thinking）
        case 'message_delta':
          // 消息结束，更新 usage
        case 'message_stop':
          // 消息结束
      }
    }

    // 3. 处理工具调用
    if (hasToolUses) {
      // 执行工具
      // 检查 compact 阈值
      // 继续循环
    }

    // 4. 处理停止原因
    switch (stopReason) {
      case 'end_turn':
        return  // 正常结束
      case 'max_tokens':
        // 尝试恢复
      case 'tool_use':
        // 继续
    }
  }
}
```

### A.3.2 Thinking 规则（注释很有意思）

```typescript
/**
 * The rules of thinking are lengthy and fortuitous. They require plenty of thinking
 * of most long duration and deep meditation for a wizard to wrap one's noggin around.
 *
 * The rules follow:
 * 1. A message that contains a thinking or redacted_thinking block must be
 *    part of a query whose max_thinking_length > 0
 * 2. A thinking block may not be the last message in a block
 * 3. Thinking blocks must be preserved for the duration of an assistant trajectory
 *    (a single turn, or if that turn includes a tool_use block then also its
 *    subsequent tool_result and the following assistant message)
 *
 * Heed these rules well, young wizard.
 */
```

### A.3.3 Compact 触发

```typescript
// 在 query loop 中，每次 assistant 消息后检查：
const autoCompactState = calculateTokenWarningState(
  messages,
  contextWindow,
  WARNING_THRESHOLD_BUFFER_TOKENS
)

// 如果超过阈值：
if (autoCompactState.shouldCompact) {
  // 执行 autoCompact
  const { messages: compacted } = await compactConversation(...)
  state = { ...state, messages: compacted }
}
```

---

## A.4 Task — 任务抽象

源码：`Task.ts` + `tasks.ts` + `tasks/`

### A.4.1 七种任务类型

```typescript
type TaskType =
  | 'local_bash'           // 本地 Shell 命令
  | 'local_agent'         // 本地 subagent（spawn 子进程）
  | 'remote_agent'        // 远程 agent（MCP）
  | 'in_process_teammate' // 进程内 teammate
  | 'local_workflow'      // 本地工作流
  | 'monitor_mcp'         // MCP 监控
  | 'dream'               // 主动模式任务
```

### A.4.2 任务 ID 生成

```typescript
// 格式：{prefix}{8位36进制随机}
// 36^8 ≈ 2.8 万亿，防暴力猜解

const TASK_ID_PREFIXES = {
  local_bash: 'b',           // 保持向后兼容
  local_agent: 'a',
  remote_agent: 'r',
  in_process_teammate: 't',
  local_workflow: 'w',
  monitor_mcp: 'm',
  dream: 'd',
}

const TASK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function generateTaskId(type: TaskType): string {
  const prefix = TASK_ID_PREFIXES[type]
  const bytes = randomBytes(8)
  let id = prefix
  for (let i = 0; i < 8; i++) {
    id += TASK_ID_ALPHABET[bytes[i]! % 36]
  }
  return id
}
```

### A.4.3 Task 基类

```typescript
// Task 是 kill 方法的抽象
type Task = {
  name: string
  type: TaskType
  kill(taskId: string, setAppState: SetAppState): Promise<void>
}

// TaskStateBase 是所有任务状态的公共字段
type TaskStateBase = {
  id: string
  type: TaskType
  status: TaskStatus  // 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  description: string
  toolUseId?: string
  startTime: number
  endTime?: number
  totalPausedMs?: number
  outputFile: string   // 输出文件路径
  outputOffset: number // 读取偏移量
  notified: boolean
}
```

### A.4.4 任务实现

| 实现 | 说明 |
|---|---|
| `LocalShellTask` | 本地 Bash 命令，超时控制 |
| `LocalAgentTask` | 启动子 Claude Code 进程 |
| `InProcessTeammateTask` | 进程内 teammate |
| `RemoteAgentTask` | MCP 远程 agent |
| `DreamTask` | 主动模式 |

---

## A.5 Tool — 工具基类

源码：`Tool.ts`

### A.5.1 Tool 类型定义

```typescript
type Tool = {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema  // JSON Schema 格式
  allowedModes?: ToolAllowedModes[]
  
  // 动态启用/禁用
  isEnabled?: () => boolean
  isConcurrencySafe?: () => boolean
  isReadOnly?: () => boolean
  isOpenWorld?: () => boolean
  
  maxResultSizeChars?: number
  shouldDefer?: boolean
  
  execute(
    args: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult>
}
```

### A.5.2 ToolUseContext — 工具执行上下文

```typescript
type ToolUseContext = {
  abortController: AbortController
  cwd: string
  env: Record<string, string>
  getAppState: () => AppState
  setAppState: SetAppState
  
  // MCP
  mcpClients: MCPServerConnection[]
  
  // 进度回调
  getToolProgress: (toolUseId: string) => ToolProgressData | undefined
  
  // Elicitation（MCP URL 授权）
  handleElicitation?: (params: ElicitRequestURLParams) => Promise<ElicitResult>
  
  // 其他选项
  options?: {
    verbose?: boolean
    mainLoopModel?: string
    thinkingConfig?: ThinkingConfig
    // ...
  }
}
```

---

## A.6 tools — 40+ 工具注册表

源码：`tools.ts`

### A.6.1 完整工具列表

```typescript
function getAllBaseTools(): Tools {
  return [
    // 核心工具
    AgentTool,                    // 启动 subagent
    TaskOutputTool,              // 任务输出
    BashTool,                    // Bash 命令
    
    // 文件工具
    GlobTool,                    // 文件 glob
    GrepTool,                    // 内容 grep
    FileReadTool,                // 读取文件
    FileEditTool,                // 编辑文件
    FileWriteTool,               // 写入文件
    NotebookEditTool,            // Jupyter notebook
    
    // Web 工具
    WebSearchTool,               // Web 搜索
    WebFetchTool,               // 页面抓取
    WebBrowserTool,             // 浏览器控制
    
    // 任务工具
    TaskCreateTool,             // 创建任务
    TaskGetTool,                // 获取任务
    TaskUpdateTool,             // 更新任务
    TaskListTool,               // 列出任务
    TaskStopTool,               // 停止任务
    
    // 协作工具
    SendMessageTool,            // Agent 间消息
    TeamCreateTool,             // 创建团队
    TeamDeleteTool,            // 删除团队
    
    // 系统工具
    SkillTool,                  // 技能调用
    MCPTool,                    // MCP 工具
    ListMcpResourcesTool,       // MCP 资源
    ReadMcpResourceTool,       // 读取 MCP 资源
    ToolSearchTool,            // 工具搜索
    ConfigTool,                 // 配置（ant only）
    
    // 计划/模式
    EnterPlanModeTool,         // 进入计划模式
    ExitPlanModeTool,           // 退出计划模式
    ExitPlanModeV2Tool,
    EnterWorktreeTool,         // 进入 worktree
    ExitWorktreeTool,           // 退出 worktree
    
    // 其他
    TodoWriteTool,              // 待办
    BriefTool,                  // 主动消息
    AskUserQuestionTool,        // 提问
    LSPTool,                    // LSP
    REPLTool,                   // REPL（ant only）
    PowerShellTool,            // PowerShell
    SyntheticOutputTool,        // 结构化输出
    SleepTool,                  // 睡眠（主动模式）
    
    // Cron / Trigger
    ...ScheduleCronTool...,    // Cron 创建/删除/列表
    RemoteTriggerTool,          // 远程触发
    
    // 实验性
    SnipTool,                  // 历史截断
    MonitorTool,                // MCP 监控
    WorkflowTool,              // 工作流
    ListPeersTool,             // UDS 消息
  ]
}
```

### A.6.2 工具条件编译

```typescript
// 通过 feature() 实现 Dead Code Elimination
const SleepTool = feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null

const RemoteTriggerTool = feature('AGENT_TRIGGERS_REMOTE')
  ? require('./tools/RemoteTriggerTool/RemoteTriggerTool.js').RemoteTriggerTool
  : null

const WebBrowserTool = feature('WEB_BROWSER_TOOL')
  ? require('./tools/WebBrowserTool/WebBrowserTool.js').WebBrowserTool
  : null

const WorkflowTool = feature('WORKFLOW_SCRIPTS')
  ? require('./tools/WorkflowTool/WorkflowTool.js').WorkflowTool
  : null
```

---

## A.7 AgentTool — Subagent 生命周期

源码：`tools/AgentTool/runAgent.ts`（~900 行）

### A.7.1 runAgent 完整生命周期

```typescript
async function* runAgent(params): AsyncGenerator<Message> {
  // ===== 1. BEFORE =====
  
  // 1.1 创建隔离的文件缓存
  const agentReadFileState = cloneFileStateCache(parentCache)
  
  // 1.2 创建独立的 AbortController
  const agentAbortController = isAsync 
    ? new AbortController() 
    : parentController
  
  // 1.3 初始化 subagent 的 MCP 服务器
  // （agent 可以定义自己的 MCP 服务器，叠加到 parent 的 MCP 上）
  const { clients, tools: agentMcpTools, cleanup } = 
    await initializeAgentMcpServers(agentDefinition, parentClients)
  
  // 1.4 注册 frontmatter hooks
  registerFrontmatterHooks(agentDefinition, agentId)
  
  // 1.5 预加载 agent 的 skills
  const skillsToPreload = agentDefinition.skills ?? []
  
  // 1.6 创建 subagent 上下文
  const agentToolUseContext = createSubagentContext(parentContext, {
    abortController: agentAbortController,
    readFileState: agentReadFileState,
    mcpClients: clients,
    tools: mergedTools,
  })
  
  // ===== 2. CORE =====
  
  try {
    // 执行 agent 的查询循环
    for await (const message of query({
      messages: initialMessages,
      systemPrompt: agentSystemPrompt,
      userContext: resolvedUserContext,
      toolUseContext: agentToolUseContext,
      maxTurns: agentDefinition.maxTurns,
    })) {
      yield message  // 流式返回
    }
  }
  
  // ===== 3. AFTER（finally 块）=====
  finally {
    // 3.1 清理 MCP 服务器（如果是 inline 定义）
    await mcpCleanup()
    
    // 3.2 清除 session hooks
    clearSessionHooks(agentId)
    
    // 3.3 清理文件缓存
    agentReadFileState.clear()
    
    // 3.4 终止 shell 任务
    killShellTasksForAgent(agentId)
    
    // 3.5 清理 todos
    rootSetAppState(prev => ({ ...prev, todos: [] }))
  }
}
```

### A.7.2 MCP 服务器初始化（Agent 级别）

```typescript
async function initializeAgentMcpServers(
  agentDefinition: AgentDefinition,
  parentClients: MCPServerConnection[],
) {
  // 如果 agent 没有定义自己的 MCP，直接返回 parent 的
  if (!agentDefinition.mcpServers?.length) {
    return { clients: parentClients, tools: [], cleanup: () => {} }
  }
  
  // 遍历 agent 的 MCP 配置
  for (const spec of agentDefinition.mcpServers) {
    if (typeof spec === 'string') {
      // 字符串：引用已有配置
      name = spec
      config = getMcpConfigByName(spec)
    } else {
      // 对象：inline 定义
      const [name, config] = Object.entries(spec)[0]!
      isNewlyCreated = true
    }
    
    // 连接 MCP 服务器
    const client = await connectToServer(name, config)
    
    // 获取工具
    const tools = await fetchToolsForClient(client)
  }
  
  // cleanup 只清理 newly created 的
  const cleanup = async () => {
    for (const client of newlyCreatedClients) {
      await client.cleanup()
    }
  }
  
  return {
    clients: [...parentClients, ...agentClients],
    tools: agentMcpTools,
    cleanup,
  }
}
```

---

## A.8 内置 Agent 定义

源码：`tools/AgentTool/builtInAgents.ts` + `built-in/`

### A.8.1 六种内置 Agent

```typescript
getBuiltInAgents() = [
  GENERAL_PURPOSE_AGENT,      // 默认通用 agent
  STATUSLINE_SETUP_AGENT,    // 状态栏配置
  EXPLORE_AGENT,             // 只读文件搜索专家
  PLAN_AGENT,               // 软件架构规划
  VERIFICATION_AGENT,         // 独立验证
  CLAUDE_CODE_GUIDE_AGENT,  // Claude Code 使用指南
]
```

### A.8.2 Agent 定义结构

```typescript
type AgentDefinition = {
  agentType: string           // 唯一标识
  whenToUse: string         // 使用场景描述
  tools: string[]            // 允许的工具列表
  source: 'built-in' | 'file'  // 来源
  getSystemPrompt: () => string  // Agent 的 system prompt
  
  // 可选
  model?: string            // 指定模型
  permissionMode?: PermissionMode
  maxTurns?: number
  memory?: AgentMemoryScope
  mcpServers?: McpServerConfig[]  // Agent 专属 MCP
}
```

### A.8.3 内置 Agent 示例

**Explore Agent（只读文件搜索）**：
```typescript
{
  agentType: 'explore',
  whenToUse: 'Use when you need to...',
  tools: ['BashTool', 'GlobTool', 'GrepTool', 'Read'],
  source: 'built-in',
  getSystemPrompt: () => `You are a file search specialist...
  
  === CRITICAL: READ-ONLY MODE ===
  You are STRICTLY PROHIBITED from:
  - Creating new files
  - Modifying existing files
  - ...`,
}
```

**Plan Agent（规划）**：
```typescript
{
  agentType: 'plan',
  whenToUse: 'Use for software architecture and planning...',
  tools: ['Read', 'GlobTool', 'GrepTool'],  // 只读
  source: 'built-in',
  getSystemPrompt: () => `You are a software architect...`,
}
```

---

## A.9 关键设计模式

### A.9.1 AsyncGenerator 流式输出

```typescript
// submitMessage 是 AsyncGenerator
async *submitMessage(prompt): AsyncGenerator<SDKMessage> {
  for await (const message of query(...)) {
    yield message  // 实时 yield，不等整个响应
  }
}

// 调用者可以：
for await (const msg of engine.submitMessage(prompt)) {
  if (msg.type === 'assistant') {
    render(msg)
  }
}
```

### A.9.2 状态隔离

```typescript
// Subagent 的状态隔离：
{
  readFileState: cloneFileStateCache(parent),  // 独立文件缓存
  abortController: new AbortController(),       // 独立中断控制
  mutableMessages: [...],                        // 独立消息历史
  mcpClients: [...parentClients, ...agentClients],  // 叠加
}
```

### A.9.3 Feature DCE

```typescript
// 只在特定条件下编译进 bundle
const SleepTool = feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null

const WebBrowserTool = feature('WEB_BROWSER_TOOL')
  ? require('./tools/WebBrowserTool/WebBrowserTool.js').WebBrowserTool
  : null
```

### A.9.4 权限追踪

```typescript
// 每个 tool 调用都经过 wrappedCanUseTool
const wrappedCanUseTool: CanUseToolFn = async (tool, input, ...) => {
  const result = await canUseTool(tool, input, ...)
  
  if (result.behavior !== 'allow') {
    this.permissionDenials.push({
      tool_name: tool.name,
      tool_use_id: toolUseID,
      tool_input: input,
    })
  }
  return result
}
```

---

## A.10 与 OpenClaw 的对应关系

| Claude Code | OpenClaw | 说明 |
|---|---|---|
| `QueryEngine` | Agent runtime | 主查询引擎 |
| `query()` | Agent loop | API 调用循环 |
| `Tool` 基类 | Skill 机制 | 工具抽象 |
| `tools.ts` 40+ 工具 | 内置 tools | 工具注册表 |
| `runAgent()` | `sessions_spawn` | Subagent 生命周期 |
| `Task.ts` | Task 系统 | 任务抽象 |
| `AgentDefinition` | `AGENTS.md` | Agent 定义 |
| `builtInAgents` | 内置 skills | 预定义 agent |
| Feature DCE | - | 条件编译 |
| `wrappedCanUseTool` | `tools.allow/deny` | 权限追踪 |


---


# 【C】Agent Collaboration — 详细模块文档

> 包含：coordinator/、tasks/、tools/AgentTool/、tools/SendMessageTool/、tools/TeamCreateTool/、services/AgentSummary/、services/PromptSuggestion/、services/extractMemories/

---

## C.1 Coordinator 模式

源码：`coordinator/coordinatorMode.ts`

### C.1.1 核心概念

```typescript
// Coordinator = 主 agent 扮演"协调者"，管理多个 worker subagent
// 协调者决定：
// - 谁执行什么任务
// - 工具访问过滤
// - 消息路由

function isCoordinatorMode(): boolean {
  return feature('COORDINATOR_MODE') &&
    isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)
}
```

### C.1.2 Coordinator 的 System Prompt

```typescript
getCoordinatorSystemPrompt() = `You are Claude Code, an AI assistant that orchestrates software engineering tasks across multiple workers.

## 1. Your Role
You are a **coordinator**. Your job is to:
- Help the user achieve their goal
- Direct workers to research, implement and verify code changes
- Synthesize results and communicate with the user
- Answer questions directly when possible

## 2. Your Tools
- ${AGENT_TOOL_NAME} - Spawn a new worker
- ${SEND_MESSAGE_TOOL_NAME} - Continue an existing worker
- ${TASK_STOP_TOOL_NAME} - Stop a running worker
- subscribe_pr_activity / unsubscribe_pr_activity - GitHub PR 事件订阅

## 3. Worker Tools Filtering
// Coordinator 过滤后只给 worker 以下工具：
workerTools = [
  BashTool, ReadTool, EditTool, GlobTool, GrepTool,
  AgentTool, TaskCreateTool, TaskOutputTool,
  MCPTool, SkillTool, SendMessageTool, TeamCreateTool, ...
]
```

### C.1.3 workerToolsContext 注入

```typescript
// 每个 worker 被限制在特定工具集合内
getCoordinatorUserContext(mcpClients, scratchpadDir)
  → { workerToolsContext: "Workers spawned via AgentTool have access to these tools: ..." }
```

---

## C.2 Forked Agent — Cache 共享

源码：`utils/forkedAgent.ts`

### C.2.1 CacheSafeParams

```typescript
// Anthropic API cache key 由以下组成：
// system prompt + tools + model + messages(prefix) + thinking config
type CacheSafeParams = {
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  forkContextMessages: Message[]  // parent 消息前缀
}
```

### C.2.2 Fork 场景与 Cache 共享

| Fork 场景 | 目的 | 共享 cache |
|---|---|---|
| SessionMemory | 周期性会话笔记 | ✅ 是 |
| ExtractMemories | 查询结束时提取记忆 | ✅ 是 |
| AutoDream | 知识整合 | ✅ 是 |
| PromptSuggestion | 主动提示建议 | ⚠️ 否（skipCacheWrite） |
| AgentSummary | Subagent 进度摘要 | ✅ 是 |
| Compact | 压缩摘要 | ⚠️ 否（maxOutputTokens 不同） |
| /btw | 顺便说 | ✅ 是 |

### C.2.3 runForkedAgent 签名

```typescript
async function runForkedAgent(params: ForkedAgentParams): Promise<ForkedAgentResult>
```

参数：
```typescript
{
  promptMessages: Message[]
  cacheSafeParams: CacheSafeParams
  canUseTool: CanUseToolFn
  forkLabel: string           // 'session_memory' | 'extract_memories' | 'supervisor'
  maxOutputTokens?: number    // ⚠️ 改变会 invalidate cache
  maxTurns?: number
  onMessage?: (msg) => void
  skipTranscript?: boolean
  skipCacheWrite?: boolean
}
```

---

## C.3 Task 系统

源码：`tasks/`

### C.3.1 LocalAgentTask — 子进程 Agent

```typescript
// 启动独立的 Claude Code 子进程
// 通过 Unix Domain Socket 与主进程通信
registerAgentForeground(agentId, taskState)
  → spawn Claude Code child process
  → ipc over UDS
  → track status
```

### C.3.2 InProcessTeammateTask — 进程内 Teammate

```typescript
// 在主进程内直接运行 agent
// 零 IPC 开销
// 通过 spawnInProcessTeammate() 启动
```

---

## C.4 SendMessageTool — Agent 间通信

源码：`tools/SendMessageTool/`

```typescript
// Agent 间消息格式：
{
  type: 'task' | 'result' | 'handoff' | 'stop',
  to: agentId,
  content: string,
  sessionId?: string
}
```

### C.4.1 消息路由

```typescript
// 主会话维护 inbox（~/.claude/inbox/<agentId>/）
// SendMessageTool 发消息到 inbox
// 目标 agent 的查询循环从 inbox 读取
```

---

## C.5 AgentSummary — 进度摘要

源码：`services/AgentSummary/agentSummary.ts`

```typescript
// 每 ~30s 为 running subagent 生成 1-2 句进度摘要
// 用于 UI 显示

// 摘要示例：
"Reading runAgent.ts"
"Fixing null check in validate.ts"
"Running auth module tests"

// 使用 runForkedAgent()，共享 prompt cache
```

---

## C.6 PromptSuggestion — 主动提示建议

源码：`services/PromptSuggestion/promptSuggestion.ts`

```typescript
// 主动模式下，猜测用户可能想说的话
// ⚠️ 不是用户发的消息，是"猜"的

// 用于 chomp inflection 功能
// 使用 runForkedAgent() 生成
// skipCacheWrite: true（不需要 cache）
```

---

## C.7 与 OpenClaw 的对应关系

| Claude Code | OpenClaw | 说明 |
|---|---|---|
| `coordinatorMode` | 无 | 多 Agent 协调者 |
| `runForkedAgent` | `sessions_spawn` | 子 agent 生命周期 |
| `CacheSafeParams` | 需实现 | API prompt cache 共享 |
| `SendMessageTool` | ACP 消息 | Agent 间通信 |
| `TeamCreateTool` | 无 | 动态创建 Agent 团队 |
| `AgentSummary` | 无 | Subagent 进度摘要 |
| `PromptSuggestion` | 无 | 主动提示建议 |

---

# 【D】System Infrastructure — 详细模块文档

> 包含：bootstrap/、constants/、types/、schemas/、services/api/、services/mcp/、services/analytics/、services/plugins/、services/oauth/、services/lsp/、entrypoints/、upstreamproxy/、cost-tracker.ts、migrations/、hooks.ts、plugins/

---

## D.1 Bootstrap — 启动状态

源码：`bootstrap/state.ts`

```typescript
// 全局单例状态
{
  getSessionId(),           // 当前会话 ID
  getProjectRoot(),         // Git 根目录
  isRemoteMode(),           // 是否远程模式
  getIsNonInteractiveSession(),  // 是否非交互会话
  getSdkBetas(),            // SDK beta 特性
  getMainLoopModel(),       // 主循环模型
  getFastModeState(),       // 快速模式
  getAgentId(),             // 当前 agent ID
}
```

---

## D.2 Constants — 常量定义

源码：`constants/`

| 文件 | 内容 |
|---|---|
| `prompts.ts` | System prompt 构建 |
| `systemPromptSections.ts` | Section memoization |
| `tools.ts` | 工具常量 |
| `querySource.ts` | 查询来源枚举 |

### D.2.1 System Prompt Section 类型

```typescript
// 可缓存 section
systemPromptSection(name, compute)

// 每次重算（动态内容）
DANGEROUS_uncachedSystemPromptSection(name, compute, reason)
```

---

## D.3 Hook 系统

源码：`types/hooks.ts` + `utils/hooks.ts`（4923 行）

### D.3.1 完整 Hook 事件

```typescript
const HOOK_EVENTS = [
  'PreToolUse',           // 工具调用前
  'PostToolUse',          // 工具调用后
  'PostToolUseFailure',   // 工具失败后
  'Stop',                 // 停止时
  'StopFailure',           // 停止失败
  'PreAgentStart',       // Agent 启动前
  'PostAgentStart',       // Agent 启动后
  'SubagentStart',        // Subagent 启动
  'SubagentStop',         // Subagent 停止
  'PreCompact',           // 压缩前
  'PostCompact',          // 压缩后
  'SessionStart',         // 会话开始
  'SessionEnd',           // 会话结束
  'Setup',                // 设置时
  'CwdChanged',          // 目录变更
  'FileChanged',         // 文件变更
  'InstructionsLoaded',   // 指令加载
  'PromptSubmission',     // Prompt 提交
  'UserIntent',          // 用户意图
  'Idle',                // 空闲
  'Wake',                // 唤醒
  'PreCommand',          // 命令前
  'PostCommand',         // 命令后
  'PrePromptBuild',      // Prompt 构建前
  'PostPromptBuild',     // Prompt 构建后
]
```

### D.3.2 Hook 响应类型

```typescript
// Sync hook
{
  continue?: boolean        // 是否继续
  suppressOutput?: boolean  // 隐藏 stdout
  stopReason?: string      // 停止原因
  decision?: 'approve' | 'block'
  reason?: string
  systemMessage?: string
}

// Async hook
{
  continue?: boolean
  hookSpecificOutput?: {...}
}
```

---

## D.4 API 层

源码：`services/api/`

| 文件 | 功能 |
|---|---|
| `claude.ts` | Anthropic API 调用 |
| `errors.ts` | 错误处理（PROMPT_TOO_LONG、Rate Limit） |
| `logging.ts` | API 日志 |
| `withRetry.ts` | 重试逻辑（429 指数退避） |
| `promptCacheBreakDetection.ts` | Prompt cache break 检测 |

---

## D.5 MCP 客户端

源码：`services/mcp/client.ts`（~3300 行）

### D.5.1 传输类型

```typescript
type Transport = 'stdio' | 'sse' | 'sse-ide' | 'http' | 'ws' | 'sdk'
```

### D.5.2 核心函数

```typescript
async function ensureConnectedClient(
  serverName: string,
  config: McpServerConfig,
): Promise<MCPServerConnection>

// Session 过期自动重连
// OAuth 401 → re-auth
// 工具描述限制 2048 字符
```

### D.5.3 OAuth 支持

```typescript
const McpOAuthConfigSchema = z.object({
  clientId: z.string().optional(),
  callbackPort: z.number().optional(),
  authServerMetadataUrl: z.string().optional(),
  xaa: z.boolean().optional()  // SEP-990 Cross-App Access
})
```

---

## D.6 Analytics / GrowthBook

源码：`services/analytics/`

| 文件 | 功能 |
|---|---|
| `growthbook.ts` | 特性开关（异步非阻塞） |
| `index.ts` | 事件日志 |
| `datadog.ts` | Datadog 集成 |

### D.6.1 GrowthBook 特性获取

```typescript
// CACHED 版本立即返回（可能 stale）
getFeatureValue_CACHED_MAY_BE_STALE('feature_name', defaultValue)

// 后台异步刷新
```

---

## D.7 Cost Tracker

源码：`cost-tracker.ts`

```typescript
getTotalCost()              // 总费用
getModelUsage()            // 模型使用统计
getTokenCounter()          // Token 计数
getTotalInputTokens()
getTotalOutputTokens()
getTotalCacheCreationInputTokens()
getTotalCacheReadInputTokens()
```

---

## D.8 Plugins

源码：`services/plugins/` + `plugins/`

### D.8.1 插件能力

```typescript
type Plugin = {
  name: string
  version: string
  channels?: string[]     // 支持的通道
  providers?: string[]    // 支持的 provider
  tools?: Tool[]          // 提供的工具
  commands?: Command[]     // 提供的命令
  skills?: Skill[]       // 提供的技能
  hooks?: Hook[]          // 提供的钩子
}
```

---

## D.9 Upstream Proxy

源码：`upstreamproxy/`

> API 请求的代理层，支持自定义上游 endpoint。

---

## D.10 Migrations

源码：`migrations/`

```typescript
// 12 个迁移函数
migrateAutoUpdatesToSettings()
migrateSonnet1mToSonnet45()
migrateSonnet45ToSonnet46()
migrateOpusToOpus1m()
migrateFennecToOpus()
// ...
```

---

# 【E】CLI Interface — 详细模块文档

> 包含：main.tsx、cli.tsx、commands.ts、commands/、cli/、history.ts、setup.ts、replLauncher.tsx

---

## E.1 主入口

源码：`main.tsx`（~4600 行）

### E.1.1 启动流程

```typescript
main()
  → run()
    → Commander 参数解析
      → preAction hooks
        → init()  // 完整初始化
        → initSinks()
        → runMigrations()
        → loadRemoteManagedSettings()
      → action handler
        → setup()  // 工作目录
        → showSetupScreens()  // 信任对话框
        → 创建 Ink Root / runHeadless
        → REPL 主循环
```

---

## E.2 CLI 子命令

源码：`cli/handlers/`

| 命令 | 功能 |
|---|---|
| `agent.ts` | claude agents list/add/remove |
| `auth.ts` | claude login/logout |
| `mcp.tsx` | claude mcp list/start/stop/remove |
| `autoMode.ts` | claude auto-mode enable/disable |
| `plugins.ts` | claude plugin 命令 |

---

## E.3 内置命令

源码：`commands/`

80+ 子命令，包括：
- `/commit` — Git commit
- `/diff` — 显示 diff
- `/review` — 代码审查
- `/test` — 生成测试
- `/plan` — 计划模式
- `/btw` — 顺便说
- `/compact` — 压缩会话
- `/memory` — 记忆管理
- `/resume` — 恢复会话

---

## E.4 History — 命令历史

源码：`history.ts`

```typescript
// 命令历史管理（ctrl+r / up-arrow）
getHistory()              // 获取历史（当前 session 优先）
getTimestampedHistory()   // 带时间戳
addToHistory(entry)       // 添加历史
removeLastFromHistory()   // 撤销上一个

// 存储：
// ~/.claude/history.jsonl（跨所有项目）
// ~/.claude/projects/<slug>/history.jsonl（项目级）

// 粘贴内容：
// 小内容直接存储（<1024 chars）
// 大内容存储 hash 引用到 paste store
```

---

# 【F】Bridge / Remote — 详细模块文档

> 包含：bridge/、remote/、server/

---

## F.1 Bridge — 桥接模式

源码：`bridge/`

```typescript
// 将本地机器暴露给远程 Claude
bridgeMain.ts           // 桥接主入口
bridgeApi.ts            // API
bridgeMessaging.ts      // 消息
replBridge.ts           // REPL 桥接
trustedDevice.ts        // 设备信任
```

---

## F.2 Remote — 远程会话

源码：`remote/`

```typescript
RemoteSessionManager.ts  // SDK 控制协议管理
// 消息类型：
// - SDKMessage
// - SDKControlRequest
// - SDKControlResponse
// - SDKControlCancelRequest
```

---

## F.3 Direct Connect — 直连服务器

源码：`server/`

```typescript
createDirectConnectSession()
directConnectManager.ts
```

---

# 【G】UI Layer — 详细模块文档

> 包含：ink/、components/、state/、hooks/、assistant/、screens/、outputStyles/、keybindings/

---

## G.1 Ink — 终端 UI 框架

源码：`ink.ts` + `ink/`

> Ink 是 React for CLI，Claude Code 用它渲染终端 UI。

### G.1.1 核心组件

```typescript
<Box>           // 盒子模型
<Text>          // 文本
<LineBuffer>    // 行缓冲
<Spacer>        // 空格
<Children>      // 子组件
```

---

## G.2 Components — React 组件

源码：`components/`

| 组件 | 功能 |
|---|---|
| `PromptInput/` | 命令行输入 |
| `Settings/` | 设置界面 |
| `TrustDialog/` | 信任对话框 |
| `StructuredDiff/` | Diff 展示 |
| `Messages/` | 消息列表 |
| `Tasks/` | 任务面板 |
| `Teams/` | 团队视图 |
| `Mcp/` | MCP 组件 |

---

## G.3 State — UI 状态

源码：`state/`

100+ 个 `use*.ts/tsx` 文件：
```typescript
useSettings.ts        // 设置状态
useCommandQueue.ts   // 命令队列
useMergedTools.ts    // 合并工具列表
useCanUseTool.tsx    // 权限检查
usePromptSuggestion.ts // 提示建议
useScheduledTasks.ts  // 定时任务
useRemoteSession.ts   // 远程会话
// ...（100+）
```

---

## G.4 Keybindings — 快捷键

源码：`keybindings/`

```typescript
// 快捷键处理
// Ctrl+C / Escape / Ctrl+Z 等
```

---

## G.5 Output Styles — 输出样式

源码：`outputStyles/`

```typescript
// 可自定义 agent 输出格式
loadOutputStylesDir()
```

---

# 【H】Platform Integrations — 详细模块文档

> 包含：buddy/、voice/、vim/、moreright/、native-ts/

---

## H.1 Buddy — 虚拟宠物伴侣

源码：`buddy/`

### H.1.1 物种系统

```typescript
// 18+ 物种
duck, goose, blob, cat, dragon, octopus, owl, penguin,
turtle, snail, ghost, axolotl, capybara, cactus, robot,
rabbit, mushroom, chonk
```

### H.1.2 属性

```typescript
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

// 每个物种有 6 个属性，稀有度越高上限越高
```

### H.1.3 ASCII Sprite

```typescript
// 3 帧 idle fidget 动画
// 5 行高，12 字符宽

// 渲染：
<CompanionSprite species="duck" state="idle" frame={0} />
```

---

## H.2 Voice — 语音

源码：`voice/`

```typescript
voiceModeEnabled.ts    // 语音模式开关
voice.ts              // 语音处理
voiceKeyterms.ts     // 关键词
voiceStreamSTT.ts    // 语音转文字流
```

---

## H.3 Native-ts — 原生优化

源码：`native-ts/`

```typescript
native-ts/
├── color-diff/     // 彩色 diff
├── file-index/     // 文件索引
└── yoga-layout/   // Yoga 布局引擎
```

---

## H.4 Vim 集成

源码：`vim/`

```typescript
// Vim 模式支持
// hjkl 移动、:w 保存等
```

---

## H.5 MoreRight 集成

源码：`moreright/`

```typescript
useMoreRight.tsx  // MoreRight 菜单集成
```

---

# 【I】Skills System — 详细模块文档

> 包含：skills/、skills/bundled/

---

## I.1 Skills 加载

```typescript
// 优先级（递减）
1. <workspace>/skills/
2. <workspace>/.agents/skills/
3. ~/.agents/skills/
4. ~/.openclaw/skills/
5. <openclaw>/skills/（bundled）
6. skills.load.extraDirs
```

---

## I.2 SKILL.md 格式

```markdown
---
name: image-lab
description: Generate or edit images via a provider-backed image workflow
---

# Skill description...

When user wants to generate images, use this skill...
```

---

## I.3 内置技能

```typescript
// skills/bundled/builtinSet.ts
getBundledSkills()
  → 内置技能列表
```

---

# 【J】Utils — 详细模块文档

> 包含：utils/

---

## J.1 核心工具

| 工具 | 功能 |
|---|---|
| `abortController.ts` | AbortController 封装 |
| `fileStateCache.ts` | LRU 文件缓存 |
| `messages.ts` | 消息构建 |
| `permissions/` | 权限检查 |
| `shell/` | Shell 执行 |
| `telemetry/` | 遥测 |
| `tokens.ts` | Token 计数 |
| `thinking.ts` | Thinking 配置 |
| `uuid.ts` | UUID 生成 |

---

## J.2 File State Cache

```typescript
// LRU 文件缓存
{
  maxEntries: 100,
  maxSizeBytes: 25MB,
  isPartialView?: boolean  // CLAUDE.md 自动注入时标记
}
```

---

## J.3 Permissions

```typescript
canUseTool(tool, input, context)
// 检查是否允许执行工具
// 考虑：
// - PermissionMode（auto/ask/bypass）
// - 路径限制
// - 工具名称过滤
// - deny rule
```
