---
name: scheduled-check
description: 检查定时任务并生成推送报告
---
# Scheduled Check Skill

检查 `memory/scheduled-tasks.json` 中的定时任务，返回到期任务的报告。

## 执行步骤

1. 读取 `memory/scheduled-tasks.json`
2. 过滤出 `enabled: true` 且 cron 表达式匹配当前时间的任务
3. 生成报告（纯文本，用于飞书推送）

## 输出格式

如果有待执行任务：
```
【定时任务提醒 ⏰】
- <任务名> (ID: <id>)
```

如果没有：
```
[无定时任务到期]
```

## 注意

- 不要调用 exec 工具，只需要 read
- 不要生成多余的分析，直接输出任务列表
