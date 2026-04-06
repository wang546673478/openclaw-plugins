# 模块四：工具系统 & MCP 集成

## 源码路径
- `src/tools.ts` — 工具注册表
- `src/Tool.ts` — 工具基类/抽象
- `src/tools/BashTool/` — Bash 工具
- `src/tools/FileEditTool/` — 文件编辑
- `src/tools/AgentTool/` — Agent 工具
- `src/tools/MCPTool/` — MCP 工具
- `src/tools/SkillTool/` — 技能工具
- `src/services/mcp/client.ts` — MCP 客户端（~3300行）
- `src/services/mcp/types.ts` — MCP 类型定义

---

## 工具注册表（tools.ts）

### 完整工具列表（getAllBaseTools）

```typescript
export function getAllBaseTools(): Tools {
  return [
    AgentTool,
    TaskOutputTool,
    BashTool,
    GlobTool,           // 只有在没有嵌入式搜索工具时
    GrepTool,           // 只有在没有嵌入式搜索工具时
    ExitPlanModeV2Tool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookEditTool,
    WebFetchTool,
    TodoWriteTool,
    WebSearchTool,
    TaskStopTool,
    AskUserQuestionTool,
    SkillTool,
    EnterPlanModeTool,
    ConfigTool,         // ant only
    TungstenTool,       // ant only
    SuggestBackgroundPRTool,  // ant only
    WebBrowserTool,
    TaskCreateTool,     // todoV2 enabled
    TaskGetTool,
    TaskUpdateTool,
    TaskListTool,
    EnterWorktreeTool,  // worktree mode
    ExitWorktreeTool,
    getSendMessageTool(),
    ListPeersTool,      // UDS_INBOX
    TeamCreateTool,     // agent swarms
    TeamDeleteTool,
    VerifyPlanExecutionTool,
    REPLTool,           // ant only
    WorkflowTool,
    SleepTool,          // proactive mode
    CronCreateTool,     // AGENT_TRIGGERS
    CronDeleteTool,
    CronListTool,
    RemoteTriggerTool,
    MonitorTool,
    BriefTool,
    SendUserFileTool,   // KAIROS
    PushNotificationTool,
    SubscribePRTool,
    PowerShellTool,
    SnipTool,           // HISTORY_SNIP
    TestingPermissionTool,  // test only
    ListMcpResourcesTool,
    ReadMcpResourceTool,
    ToolSearchTool,
  ]
}
```

---

## 工具基类（Tool.ts）

```typescript
export type Tool = {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema
  allowedModes?: ToolAllowedModes[]
  isEnabled?: () => boolean  // 动态启用/禁用
  execute(
    args: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult>
}
```

### ToolUseContext（工具执行上下文）

```typescript
export type ToolUseContext = {
  abortSignal: AbortSignal
  cwd: string
  env: Record<string, string>
  getAppState: () => AppState
  setAppState: SetAppState
  mcpClients: MCPServerConnection[]
  getToolProgress: (toolUseId: string) => ToolProgressData | undefined
  handleElicitation?: (params: ElicitRequestURLParams) => Promise<ElicitResult>
  ...
}
```

---

## 核心工具实现

### 1. BashTool

```typescript
// 支持多种模式
type BashMode = 'live' | 'streaming' | 'monitor'

// 关键功能：
// - timeout 支持（默认 60000ms）
// - 子进程环境变量注入
// - 输出持久化到磁盘
// - 退出码处理
// - Signal 处理（SIGTERM/SIGINT）
```

### 2. FileEditTool

```typescript
// 基于 unified+diff 架构
// 步骤：
// 1. Read 原文件
// 2. 应用 unified diff
// 3. Validate 语法
// 4. Write 回去
```

### 3. AgentTool

```typescript
// 启动子 Agent 执行任务
// 子 Agent 可以是：
// - Built-in agent
// - Custom agent（从 ~/.claude/agents/ 加载）
// 支持 agentType 覆盖
```

### 4. SkillTool

```typescript
// 动态加载技能
// 技能目录：~/.claude/skills/
// 支持：
// - Built-in skills（内置）
// - External skills（ clawhub 安装）
```

---

## MCP 集成（Model Context Protocol）

### 传输类型

```typescript
export type Transport = 'stdio' | 'sse' | 'sse-ide' | 'http' | 'ws' | 'sdk'
```

### MCP 客户端架构

```typescript
// 核心函数
async function ensureConnectedClient(
  serverName: string,
  config: McpServerConfig,
  ...): Promise<MCPServerConnection>

// 支持的传输
const transportMap = {
  stdio: StdioClientTransport,
  sse: SSEClientTransport,
  'sse-ide': SSEClientTransport + IDE headers
  http: StreamableHTTPClientTransport,
  ws: WebSocketTransport,
  sdk: SdkControlClientTransport
}
```

### MCP OAuth 支持

```typescript
// OAuth 1.0 / 2.0 + XAA (Cross-App Access)
const McpOAuthConfigSchema = z.object({
  clientId: z.string().optional(),
  callbackPort: z.number().optional(),
  authServerMetadataUrl: z.string().optional(),
  xaa: z.boolean().optional()  // SEP-990
})
```

### MCP 工具封装

```typescript
// MCP 工具被包装成 Claude Code 工具
const mcpTool: Tool = {
  name: buildMcpToolName(serverName, mcpTool.name),
  description: mcpTool.description,
  inputSchema: normalizeMcpSchema(mcpTool.inputSchema),
  execute: async (args, context) => {
    const client = await ensureConnectedClient(serverName, config)
    const result = await client.callTool(mcpTool.name, args)
    return result
  }
}
```

### MCP 资源配置

```typescript
// Resources（类似文件系统的虚拟数据）
ListMcpResourcesTool
ReadMcpResourceTool

// 自动订阅 MCP 服务器的工具列表和资源列表变化
// 变化时更新工具注册表
```

### MCP 官方注册表

```typescript
// 官方 MCP 服务器列表
const officialMcpServers = [
  'filesystem',
  'git',
  'postgres',
  'mysql',
  'slack',
  'gmail',
  'google-calendar',
  'aws-kb-retrieval-server',
  'bigquery',
  'github',
  ...
]
```

### Session Expired 处理

```typescript
// MCP 服务器会返回 HTTP 404 + JSON-RPC code -32001 表示 session 过期
// Claude Code 自动重试逻辑
if (isMcpSessionExpiredError(error)) {
  clearServerCache(serverName)
  return ensureConnectedClient(serverName, config)  // 重新连接
}
```

### MCP Auth 错误处理

```typescript
// OAuth token 过期返回 401
// 自动触发 re-auth 流程
if (error instanceof McpAuthError) {
  updateServerStatus(serverName, 'needs-auth')
  await runAuthFlow(serverName)
}
```

---

## 关键设计

### 1. 嵌入式搜索工具
```typescript
// 如果 bun 二进制内置了 bfs/ugrep，
// GlobTool/GrepTool 被替换为嵌入式版本
hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]
```

### 2. 工具超时
```typescript
// MCP 工具默认超时 ~27.8 小时（几乎无限）
// Bash 工具默认 60 秒
const DEFAULT_MCP_TOOL_TIMEOUT_MS = 100_000_000
```

### 3. MCP 描述长度限制
```typescript
// 防止 OpenAPI 生成的 MCP 服务器塞入过多描述
const MAX_MCP_DESCRIPTION_LENGTH = 2048
```

### 4. 工具搜索（ToolSearchTool）
```typescript
// 实验性功能（EXPERIMENTAL_SKILL_SEARCH）
// 延迟加载、按需搜索工具
isToolSearchEnabledOptimistic() ? [ToolSearchTool] : []
```
