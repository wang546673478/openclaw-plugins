# HEARTBEAT.md

> **重要更新 2026-04-06：** 定时记忆保存已改用 `openclaw cron`，不再依赖 HEARTBEAT。

## 定时任务（可靠触发，已迁移到 cron）

### session-memory（每30分钟）
```
openclaw cron add --name "session-memory" --cron "*/30 * * * *"
```
功能：检查距上次保存是否超过30分钟，读取最近会话摘要，追加保存到 memory/YYYY-MM-DD.md

### auto-dream（每60分钟）
```
openclaw cron add --name "auto-dream" --cron "0 * * * *"
```
功能：检查距上次整合是否超过24小时，整合会话摘要到 memory/YYYY-MM-DD-dream.md

---

## HEARTBEAT 机制（作为备用）

OpenClaw 的 heartbeat 机制本身还在，但作为 cron 的备用。

### 机制一：查询结束提取（HEARTBEAT 时检查）

每次 heartbeat **都检查**：
1. 检查最近消息：是否**连续 5 轮无 tool call**
2. 如果是：
   - 调用 **session-memory** skill，执行"查询结束提取"
3. 如果否：回复 `HEARTBEAT_OK`

### 机制二：compaction 前提醒（before_compaction hook）

在上下文压缩前，通过 before_compaction hook 注入记忆保存提醒。

---

## 为什么用 cron 替代 HEARTBEAT？

- HEARTBEAT 依赖 AI 主动响应，AI 忙时可能跳过
- cron 由系统调度，可靠性更高
- cron 完成会触发主 session heartbeat，AI 能看到结果

---

## 状态文件

- `memory/.session-memory-state.json` — session-memory 状态
- `memory/.dream-state.json` — auto-dream 状态
- `~/.openclaw/cron/jobs.json` — cron 任务定义（系统文件）
