# Claude Code 源码研读 — 完整总结

> 基于 claude-code-2.1.88，源码路径：`/home/hhhh/claude-code-sourcemap-main/restored-src/src/`

---

## 一、整体架构

### 技术栈
| 层次 | 技术 |
|---|---|
| 运行时 | Bun |
| 语言 | TypeScript（~2800 源文件） |
| UI 框架 | Ink（React for CLI） |
| 打包 | 编译成单个 `cli.js` + `cli.js.map`（含完整源码） |
| HTTP 客户端 | `@anthropic-ai/sdk` |
| MCP 协议 | `@modelcontextprotocol/sdk` |
| 状态管理 | 自研 Store（类 Zustand） |
| CLI 参数 | Commander.js |

---

## 二、入口 & 启动

### 两条启动路径

#### 快速路径（cli.tsx）
零模块加载，处理特殊标志：
- `--version` — 直接输出版本
- `--dump-system-prompt` — 打印 system prompt
- `--claude-in-chrome-mcp` — Chrome MCP 服务器
- `--computer-use-mcp` — Computer Use MCP
- `--daemon-worker=<kind>` — Daemon 工作者
- `claude remote-control` — 桥接模式
- `claude daemon` — 长驻进程
- `claude ps/logs/attach/kill` — 会话管理
- `--worktree --tmux` — Tmux 快速路径

#### 完整路径（main.tsx）
```
Commander 参数解析
  → preAction（init、迁移、配置加载）
    → setup（工作目录、Git、终端备份）
      → showSetupScreens（信任对话框、登录、onboarding）
        → 创建 Ink Root（交互）/ runHeadless（--print）
          → REPL 主循环（QueryEngine）
```

### 关键设计

1. **前置并行预取**：MDM 配置、Keychain 认证并行 fire-and-forget，节省 ~65ms
2. **feature() 条件编译**：通过 `bun:bundle` 实现 DCE，ant 内部版 vs 外部版差异极大
3. **数据迁移**：12 个迁移函数处理配置格式演变
4. **客户端类型**：自动检测 GitHub Actions / SDK / VSCode / CLI 等环境

---

## 三、Agent 核心循环（QueryEngine）

### 架构

```typescript
class QueryEngine {
  mutableMessages: Message[]        // 会话历史
  abortController: AbortController  // 中断控制
  permissionDenials: []             // 权限拒绝记录
  totalUsage: NonNullableUsage      // API 使用量
  readFileState: FileStateCache     // 文件读取缓存
}
```

### submitMessage() 流程

```
1. fetchSystemPromptParts()
   └── 获取 system prompt（默认 + 自定义 + memory）

2. processUserInput()
   ├── 解析 slash commands
   ├── 处理 attachments
   └── 返回允许工具列表

3. API 查询循环（AsyncGenerator）
   ├── 组装 messages[]
   ├── 调用 Anthropic API（流式）
   ├── 处理 tool_use 请求
   └── 循环直到 end_turn

4. 工具执行
   → canUseTool() 权限检查
   → 查找工具实现
   → 执行工具（spawn 子进程）
   → 结果转 assistant 消息
   → 继续 API 循环

5. 消息历史管理
   → Auto Compact（过长时压缩）
   → HISTORY_SNIP（消息截断）
   → Context Collapse（上下文折叠）
```

### 支持的 Thinking 模式
```typescript
{ type: 'adaptive' }  // 模型自适应（默认）
{ type: 'enabled', budgetTokens: number }
{ type: 'disabled' }
```

### 消息压缩（Compact）
- **Auto Compact**：历史过长时自动压缩
- **Snip**：删除中间消息，保留结构
- **Replay**：压缩后生成 replay prompt 让模型恢复上下文

---

## 四、任务系统（Task）

### 7 种任务类型

| TaskType | 前缀 | 说明 |
|---|---|---|
| `local_bash` | `b` | 本地 Shell 命令 |
| `local_agent` | `a` | 本地 Agent（spawn 子进程） |
| `remote_agent` | `r` | 远程 Agent（MCP 协议） |
| `in_process_teammate` | `t` | 进程内队友（零 IPC 开销） |
| `local_workflow` | `w` | 本地工作流 |
| `monitor_mcp` | `m` | MCP 监控任务 |
| `dream` | `d` | 主动探索模式 |

### 任务 ID
- 格式：`{prefix}{8位36进制随机}`
- 安全：36^8 ≈ 2.8 万亿组合，防暴力猜解

### 输出持久化
- 所有任务输出写入 `~/.claude/sessions/<sessionId>/tasks/<taskId>.txt`
- 支持实时监控（monitor 模式）和 offset 续读

### 主会话后台任务
- Ctrl+B 两次 → 当前查询后台运行
- Task ID 前缀为 `s`
- 完成后发送通知

---

## 五、工具系统（Tools）

### 30+ 内置工具

**文件系统**：`BashTool`、`FileReadTool`、`FileEditTool`、`FileWriteTool`、`GlobTool`、`GrepTool`、`NotebookEditTool`

**Agent 协作**：`AgentTool`（启动子 Agent）、`TaskCreateTool`、`TaskListTool`、`TaskOutputTool`、`SendMessageTool`、`TeamCreateTool`、`TeamDeleteTool`

**Web**：`WebSearchTool`、`WebFetchTool`、`WebBrowserTool`

**系统**：`ConfigTool`、`LSPTool`、`SkillTool`、`AskUserQuestionTool`、`ExitPlanModeTool`、`EnterPlanModeTool`

**自动化**：`ScheduleCronTool`（定时任务）、`RemoteTriggerTool`、`MonitorTool`、`BriefTool`、`SleepTool`（主动模式）

**MCP**：`MCPTool`、`ListMcpResourcesTool`、`ReadMcpResourceTool`

**其他**：`TodoWriteTool`、`ExitPlanModeV2Tool`、`TungstenTool`（ant only）

### 工具基类

```typescript
type Tool = {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema
  allowedModes?: ToolAllowedModes[]
  isEnabled?: () => boolean  // 动态开关
  execute(args, context): Promise<ToolResult>
}
```

### BashTool 关键特性
- 子进程隔离
- 超时控制（默认 60s）
- 环境变量注入
- 输出实时流 + 持久化
- Signal 处理（SIGTERM/SIGINT）

### FileEditTool 架构
- 基于 unified + diff 算法
- Read → Apply diff → Validate → Write

---

## 六、MCP 集成（Model Context Protocol）

### 传输类型
`stdio` | `sse` | `http` | `ws` | `sdk`

### 客户端架构
```typescript
// 连接管理
ensureConnectedClient(serverName, config)
  → StdioClientTransport | SSEClientTransport | HTTP | WebSocket
  → MCP SDK Client

// Session 过期自动重连
// OAuth 401 → 触发 re-auth 流程
```

### MCP 工具包装
```typescript
// MCP 工具 → Claude Code 工具
buildMcpToolName(serverName, mcpTool.name)
// 工具描述限制 2048 字符（防 OpenAPI 膨胀）
```

### MCP 配置来源
1. `local` (.clauderc)
2. `project` (.claude.json)
3. `user` (settings.json)
4. `dynamic` (GrowthBook)
5. `enterprise` (企业托管)
6. `claudeai` (官方服务器)
7. `managed` (MDM)

### 官方 MCP 服务器
`filesystem`、`git`、`postgres`、`mysql`、`slack`、`gmail`、`google-calendar`、`aws-kb-retrieval`、`bigquery`、`github` 等

---

## 七、命令系统

### 80+ 子命令

**本地**：`config`、`login`、`logout`、`doctor`、`init`、`session`、`resume`、`compact`、`memory`、`theme`

**Prompt（slash）**：`/commit`、`/diff`、`/review`、`/test`、`/plan`、`/btw`

**协作**：`agents`、`team`、`peers`、`workflow`

**开发**：`mcp`、`skills`、`plugin`、`hooks`

**高级**：`teleport`（远程）、`bridge`（桥接模式）、`sandbox-toggle`、`perf-issue`

---

## 八、协作功能（Agent Swarms）

### 进程内 Teammate
- 零 IPC 开销，直接内存通信
- 用于多 Agent 协作场景

### LocalAgentTask
- spawn 子进程
- Unix Domain Socket 通信
- 子进程可是不同 `--agent` 类型

### RemoteAgentTask
- MCP 协议连接到远程实例

### SendMessageTool
- Agent 间消息传递：`{ to: agentId, content: string }`

### TeamCreateTool / TeamDeleteTool
- 动态创建/销毁 Agent 团队

### UDS Inbox（ListPeersTool）
- Unix Domain Socket 消息队列

### 协调者模式（COORDINATOR_MODE）
- 多 Agent 由协调者管理
- 工具访问受协调者过滤

### 桥接模式（BRIDGE_MODE）
- `claude remote-control` — 暴露本地机器给远程 Claude

---

## 九、状态管理

### AppState 结构
```typescript
{
  settings: SettingsJson
  mainLoopModel: ModelSetting
  tasks: { [taskId]: TaskState }
  mcp: { clients, tools, commands, resources }
  toolPermissionContext: ToolPermissionContext
  fileHistory: FileHistoryState
  kairosEnabled: boolean
  replBridgeEnabled: boolean
  agentNameRegistry: Map<string, AgentId>
}
```

### Store 架构
- 自研类 Zustand Store
- `getAppState()` / `setAppState()` 访问
- `onChangeAppState()` 监听变更

---

## 十、插件 & 技能系统

### 插件（Plugins）
- 路径：`~/.claude/plugins/`
- 可提供：tools、commands、hooks、mcpServers、skills
- 支持版本管理、自动更新

### 技能（Skills）
- 路径：`~/.claude/skills/`
- 通过 `SkillTool` 调用
- 支持 clawhub 安装

---

## 十一、权限模型

### PermissionMode
- `auto` — 自动允许安全操作
- `ask` — 每个操作确认
- `bypassPermissions` — 跳过所有确认

### 路径限制
```typescript
ToolPermissionContext = {
  allowedPaths: Set<string>
  deniedPaths: Set<string>
  additionalWorkingDirectories: Map<string, boolean>
  sandboxDirectory?: string
}
```

### Auto Mode 分类器
- `TRANSCRIPT_CLASSIFIER` 特性
- 自动判断哪些操作安全可自动执行

---

## 十二、关键设计哲学

1. **Source Map 完整保真**：所有 TypeScript 源码编入 `cli.js.map`，可完整还原调试

2. **feature() DCE**：条件编译，ant 内部版含大量实验性功能（COORDINATOR_MODE、KAIROS、AGENT_SWARMS 等）

3. **AsyncGenerator 流式**：QueryEngine 的 `submitMessage()` 是 AsyncGenerator，实时 yield 中间结果

4. **任务输出磁盘化**：所有任务输出写入磁盘文件，支持后台任务和续读

5. **任务 ID 安全**：36 进制 8 位随机，防止暴力猜解

6. **并行预取**：MDM、Keychain、Analytics 等并行 fire-and-forget

7. **MCP 协议优先**：大量基础设施围绕 MCP 构建，支持扩展工具/资源/提示

8. **零信任权限**：默认 `ask` 模式，路径白名单/黑名单，deny rule 追踪
