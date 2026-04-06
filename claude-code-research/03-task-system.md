# 模块三：任务系统

## 源码路径
- `src/Task.ts` — 任务基础类型
- `src/tasks/types.ts` — 所有任务状态类型
- `src/tasks/LocalShellTask/` — Bash 任务
- `src/tasks/LocalAgentTask/` — 本地 Agent 任务
- `src/tasks/LocalMainSessionTask.ts` — 主会话背景任务
- `src/tasks/InProcessTeammateTask/` — 进程内队友
- `src/tasks/DreamTask/` — 主动模式任务
- `src/tasks/RemoteAgentTask/` — 远程 Agent
- `src/tasks/LocalWorkflowTask/` — 本地工作流
- `src/tasks/MonitorMcpTask/` — MCP 监控任务

---

## 任务类型（TaskType）

```typescript
export type TaskType =
  | 'local_bash'        // 本地 Bash 命令
  | 'local_agent'       // 本地 Agent（spawn 子进程）
  | 'remote_agent'      // 远程 Agent
  | 'in_process_teammate' // 进程内 teammate
  | 'local_workflow'    // 本地工作流
  | 'monitor_mcp'       // MCP 监控
  | 'dream'             // 主动模式
```

## 任务 ID 前缀

| 类型 | 前缀 | 说明 |
|---|---|---|
| `local_bash` | `b` | 保持向后兼容 |
| `local_agent` | `a` | |
| `remote_agent` | `r` | |
| `in_process_teammate` | `t` | |
| `local_workflow` | `w` | |
| `monitor_mcp` | `m` | |
| `dream` | `d` | |
| `main-session` | `s` | Ctrl+B 后台任务 |

Task ID = 前缀 + 8位随机字符（36^8 ≈ 2.8万亿组合）

---

## 任务状态（TaskStateBase）

```typescript
export type TaskStateBase = {
  id: string
  type: TaskType
  status: TaskStatus  // 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  description: string
  toolUseId?: string   // 关联的 tool_use ID
  startTime: number
  endTime?: number
  totalPausedMs?: number
  outputFile: string   // 输出文件路径
  outputOffset: number // 读取偏移量
  notified: boolean    // 是否已通知
}
```

---

## 各任务实现

### 1. LocalShellTask（bash 任务）

- 执行本地 shell 命令
- 支持 timeout
- 输出写入磁盘（`~/.claude/sessions/<session>/tasks/<taskId>.txt`）
- 支持 `monitor` 模式（任务输出实时监控）

### 2. LocalAgentTask（本地 Agent）

- spawn 新的 Claude Code 子进程执行任务
- 使用 Unix socket 通信
- 子进程可以是不同 `--agent` 类型
- 主进程跟踪子进程状态

### 3. InProcessTeammateTask（进程内队友）

- 在主进程内运行 Agent（不 spawn 子进程）
- 通过内存直接通信（避免 IPC 开销）
- 支持消息传递、任务协作

### 4. RemoteAgentTask（远程 Agent）

- 通过 MCP 连接到远程 Claude Code 实例
- 任务在远程机器执行

### 5. DreamTask（主动模式）

- `dream` 任务类型
- Agent 主动探索和行动，不需要等待指令

### 6. MonitorMcpTask（MCP 监控）

- 监控 MCP 服务器资源/工具变化
- 可触发回调

---

## 主会话后台任务（LocalMainSessionTask）

当用户在交互模式下按 **Ctrl+B** 两次：
1. 当前查询被"后台化"
2. 继续在后台运行
3. UI 清空到新的 prompt
4. 查询完成后发送通知

```typescript
// Task ID 生成
function generateMainSessionTaskId(): string {
  const bytes = randomBytes(8)
  let id = 's'
  for (let i = 0; i < 8; i++) {
    id += TASK_ID_ALPHABET[bytes[i]! % TASK_ID_ALPHABET.length]
  }
  return id
}
```

---

## 任务框架（Task Framework）

```typescript
registerTask(taskId, taskState)
updateTaskState(taskId, updater)
evictTaskOutput(taskId)  // 清理输出文件
getTaskOutputPath(taskId) // 获取输出路径
```

所有任务注册到全局任务框架，支持：
- 状态持久化
- 输出追踪
- 后台任务指示器
- 任务通知

---

## 关键设计

### 1. 输出持久化到磁盘
每个任务的输出写入 `~/.claude/sessions/<sessionId>/tasks/<taskId>.txt`，而不是内存。

```typescript
const outputFile = getTaskOutputPath(taskId)
fs.writeFileSync(outputFile, output, 'utf-8')
```

### 2. 后台任务指示器
```typescript
export function isBackgroundTask(task: TaskState): boolean {
  if (task.status !== 'running' && task.status !== 'pending') return false
  // 前台任务（isBackgrounded === false）不算"后台任务"
  if ('isBackgrounded' in task && task.isBackgrounded === false) return false
  return true
}
```

### 3. Task ID 安全
使用 36 进制随机字符串（36^8），防止暴力猜解会话目录中的任务文件。

### 4. Teammate 协作
- 进程内 teammate 通过内存直接通信
- 进程间（LocalAgentTask）通过 Unix Domain Socket
- RemoteAgentTask 通过 MCP 协议
