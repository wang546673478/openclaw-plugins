---
name: cron-wake
description: 每分钟唤醒检查定时任务，通过 sessions_send 主动推送提醒
---
# Cron Wake Skill

配合 OpenClaw cron tool 使用，每分钟检查定时任务并主动推送到飞书。

## 工作原理

1. OpenClaw cron 每分钟触发一次
2. cron 唤醒一个独立的 subagent（不在主对话里）
3. subagent 检查任务并直接通过 Feishu API 推送消息

## 注意

这个 skill 需要 OpenClaw 支持 cron 触发 subagent，且 subagent 有权限调用 Feishu API。

## 如果不支持上述方式

可以用 HEARTBEAT.md 机制：
- HEARTBEAT 每 30 秒检查一次
- 满足条件时，通过内嵌的 exec 工具直接调用 curl 推送飞书消息
