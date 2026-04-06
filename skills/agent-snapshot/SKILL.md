---
name: agent-snapshot
description: Subagent 定期快照内存状态
---
# Agent Snapshot Skill

定期将当前会话的内存状态快照到文件，用于：
- 长时间任务的中断恢复
- 多 agent 之间的状态共享
- 调试和追踪

## 使用场景

- Subagent 运行时间较长（> 30 分钟）
- 需要在 agent 崩溃后恢复状态
- 多个 agent 需要共享工作进度

## 执行步骤

### 1. 检查是否需要快照

通过 `sessions_list` 获取当前活跃的 subagent：

- 如果有 `running` 状态的 subagent
- 且据上次快照已 ≥ 10 分钟

则执行快照。

### 2. 收集状态

通过 `sessions_history` 获取 subagent 的最近消息，提取：
- 当前任务描述
- 最近的 tool calls 和结果
- 已完成的步骤
- 遇到的错误或问题

### 3. 写入快照

保存到 `memory/snapshots/YYYY-MM-DD-HHMM-snapshot.md`：

```markdown
# Agent Snapshot - YYYY-MM-DD HH:mm

## 任务
<当前任务描述>

## 进度
- 已完成：<步骤列表>
- 进行中：<当前步骤>

## 状态
<running/completed/failed>

## 最近 Tool Calls
<简要列出最近 5-10 个 tool calls>

## 错误/警告
<如果有>
```

### 4. 更新快照索引

追加到 `memory/snapshots/index.md`：

```markdown
| HH:mm | <任务摘要> | <状态> |
```

## 恢复

如果 agent 需要恢复：
1. 读取最新的 snapshot 文件
2. 将状态信息注入到新 agent 的 context
3. 从中断点继续
