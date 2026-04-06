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
