# 模块六：状态管理 & 插件系统

## 状态管理（AppState）

### AppState 结构（核心字段）

```typescript
export type AppState = {
  settings: SettingsJson
  verbose: boolean
  mainLoopModel: ModelSetting
  statusLineText: string | undefined
  expandedView: 'none' | 'tasks' | 'teammates'
  toolPermissionContext: ToolPermissionContext
  agent: string | undefined
  kairosEnabled: boolean
  replBridgeEnabled: boolean
  replBridgeConnected: boolean
  replBridgeSessionActive: boolean
  // 任务状态
  tasks: { [taskId: string]: TaskState }
  // Agent 名称注册表
  agentNameRegistry: Map<string, AgentId>
  // MCP 状态
  mcp: {
    clients: MCPServerConnection[]
    tools: Tool[]
    commands: Command[]
    resources: Record<string, ServerResource[]>
  }
  // 文件历史
  fileHistory: FileHistoryState
  // 归因状态
  attribution: AttributionState
}
```

### Store 架构

```typescript
// 使用 Zustand 风格的 Store
const store = createStore()

// AppStateStore = 围绕 store 的封装
// 提供 getAppState() / setAppState() 访问
```

### 状态变更监听

```typescript
onChangeAppState(callback: (state: AppState) => void)
// 用于：
// - 任务面板更新
// - Footer 状态栏更新
// - UI 重渲染触发
```

---

## 插件系统

### 插件类型

```typescript
export type Plugin = {
  name: string
  version: string
  tools?: Tool[]
  commands?: Command[]
  hooks?: Hook[]
  mcpServers?: McpServerConfig[]
  skills?: Skill[]
}
```

### 插件目录

```
~/.claude/plugins/
~/.claude/plugins/cache/
~/.claude/plugins/managed/
```

### 插件加载

```typescript
loadAllPluginsCacheOnly()
// 加载所有插件（缓存）
initBundledPlugins()  // 内置插件
initializeVersionedPlugins()  // 版本化插件
cleanupOrphanedPluginVersionsInBackground()  // 清理旧版本
```

### 插件 MCP 集成

```typescript
mcpPluginIntegration.ts
// 插件可提供 MCP 服务器配置
// 自动注册到 MCP 客户端
```

### 插件命令

```typescript
// 插件可注册 CLI 命令
loadPluginCommands()
// 命令通过 /plugin:<name>:<command> 调用
```

---

## 技能系统（Skills）

### 技能目录

```
~/.claude/skills/
~/.claude/skills/bundled/  # 内置技能
```

### 技能注册

```typescript
initBundledSkills()
// 加载所有内置技能
getSlashCommandToolSkills()
// 返回所有技能的 slash command
```

### 技能发现

```typescript
// 实验性功能
feature('EXPERIMENTAL_SKILL_SEARCH')
// 延迟加载、按需发现技能
```

---

## MCP 服务器配置

### 配置来源

```typescript
getAllMcpConfigs()
// 按优先级排序：
// 1. local (.clauderc)
// 2. project (.claude.json)
// 3. user (~/.claude/settings.json)
// 4. dynamic (GrowthBook)
// 5. enterprise (企业托管)
// 6. claudeai (官方 MCP)
// 7. managed (MDM)
```

### MCP 过滤

```typescript
filterMcpServersByPolicy()
// 根据组织策略过滤 MCP 服务器
areMcpConfigsAllowedWithEnterpriseMcpConfig()
// 企业配置冲突检查
```

---

## 权限系统

### PermissionMode

```typescript
export type PermissionMode =
  | 'auto'     // 自动允许安全操作
  | 'ask'      // 每个操作询问
  | 'bypassPermissions'  // 跳过所有确认
```

### 工具权限上下文

```typescript
export type ToolPermissionContext = {
  allowedPaths: Set<string>         // 允许的文件路径
  deniedPaths: Set<string>          // 拒绝的路径
  additionalWorkingDirectories: Map<string, boolean>  // 额外工作目录
  sandboxDirectory?: string          // 沙箱目录
}
```

### 权限检查

```typescript
canUseTool(tool, input, context)
// 检查工具是否可用
// 考虑：
// - PermissionMode
// - 路径限制
// - 工具名称过滤
// - deny rule
```

### 自动模式

```typescript
// auto 模式下自动允许的操作
// 通过 autoModeState.ts 追踪
feature('TRANSCRIPT_CLASSIFIER')
// 分类器决定哪些操作安全可自动执行
```
