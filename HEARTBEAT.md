# HEARTBEAT.md

## SessionMemory 检查（双重机制）

### 机制一：定期保存

每30分钟检查一次：

1. 读取 `memory/.session-memory-state.json` 获取 `lastSavedAt`
2. 如果距上次保存 **≥ 30 分钟**：
   - 调用 **session-memory** skill，执行"机制一：定期保存"
3. 如果不需要保存：回复 `HEARTBEAT_OK`

### 机制二：查询结束提取

每次 heartbeat **都检查**（不只是30分钟间隔）：

1. 检查最近消息：是否**连续 5 轮无 tool call**
2. 如果是：
   - 调用 **session-memory** skill，执行"机制二：查询结束提取"
3. 如果否：回复 `HEARTBEAT_OK`

## Auto-Dream 检查（跨会话整合）

每小时检查一次：

1. 读取 `memory/.dream-state.json` 获取 `lastConsolidatedAt`
2. 读取 `memory/.dream-lock.json` 检查是否被锁定
3. 如果：
   - 距上次整合 **≥ 24 小时**
   - 此期间有 **≥ 5 个新会话**（通过 `sessions_list` 判断）
   - 没有其他任务在运行（锁不存在或已过期）
   
   则：调用 **auto-dream** skill，执行跨会话记忆整合

4. 如果不满足条件：回复 `HEARTBEAT_OK`

## 为什么都在 HEARTBEAT 里？

- OpenClaw 的 heartbeat 会周期性触发
- 比 cron 更轻量，适合这种"检查+可能执行"的场景
- 如果需要更精确的定时，可以 later 迁移到 cron tool

## 状态文件

- `memory/.session-memory-state.json` — session-memory 状态
- `memory/.dream-state.json` — auto-dream 状态
- `memory/.dream-lock.json` — auto-dream 锁
# test
