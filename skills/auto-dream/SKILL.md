---
name: auto-dream
description: 跨会话记忆整合（梦境模式）
---
# Auto-Dream Skill

定期将多个会话的分散记忆整合为结构化知识。

## 何时触发

由外部 cron 调度触发，或 HEARTBEAT 检查到满足条件时调用。

## 触发条件

- 距上次整合 **≥ 24 小时**
- 此期间有 **≥ 5 个新会话**
- 当前没有其他整合任务在运行（锁文件）

## 执行步骤

### 1. 检查并获取锁

读取 `memory/.dream-lock.json`：

```json
{
  "lockedAt": "2026-04-05T10:00:00+08:00",
  "by": "auto-dream"
}
```

如果锁存在且 `lockedAt` 距今 < 1小时，说明有任务在运行，跳过。

获取锁：写入当前时间戳到 `memory/.dream-lock.json`。

### 2. 收集会话材料

通过 `sessions_list` 获取最近活跃的会话，读取每个会话的 `memory/YYYY-MM-DD.md` 文件，收集所有"会话摘要"和"记忆提取"条目。

### 3. 识别主题和模式

分析收集到的材料，识别：
- **重复出现的主题**（用户在多次会话中关注同一问题）
- **未完成的任务**（上次提到但没做完的）
- **技术决策**（代码风格、技术选型的演变）
- **长期目标**（用户的项目方向）

### 4. 生成整合报告

写入 `MEMORY.md` 或 `memory/YYYY-MM-DD-dream.md`：

```markdown
## 梦境整合报告 - YYYY-MM-DD

### 主题聚合
<识别出的3-5个核心主题>

### 未完成任务
<上次提到的、待完成的事项>

### 决策记录
<技术决策及其时间线>

### 下一步
<基于模式的预测：用户接下来可能想做什么>
```

### 5. 更新状态

更新 `memory/.dream-state.json`：

```json
{
  "lastConsolidatedAt": "<当前时间>",
  "sessionsConsolidated": <会话数量>,
  "dreamFile": "memory/YYYY-MM-DD-dream.md"
}
```

### 6. 释放锁

删除 `memory/.dream-lock.json`。

## 注意事项

- 整合是**增量**的，不要删除旧内容
- 关注**模式和关系**，不只是罗列
- 如果材料太少（< 3个会话），跳过整合
- 释放锁是必须的，否则下次不会运行
