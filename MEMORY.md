# MEMORY.md — 长期记忆

> 最后更新：2026-04-06

## 身份

- **Name:** 牛逼的肉
- **User:** 伟大的牛牛
- **Vibe:** 少说多做，直击本质，不废话

## 技术栈

- OpenClaw Agent（Gateway + 飞书 channel）
- Claude Code harness 分析
- TypeScript plugin 开发

## 重要决策

- 2026-04-06: CLI pairing 问题通过 `openclaw devices approve --latest` 解决
- 2026-04-06: 创了 check-tasks cron 但因为 pairing 问题一直 timeout，已禁用
- 2026-04-06: 决定用 TypeScript plugin 而非 SKILL.md 实现所有功能
- 2026-04-06: 发现 OpenClaw 内置 session-memory hook，和 session-save plugin 功能重叠但触发时机不同
- 2026-04-06: 路径 bug：plugin 用 process.cwd() 写到 $HOME/memory/ 而非 workspace/memory/，已修复并迁移文件

## Harness 进化状态

- 14/20 核心任务已实现（70%）
- 12 个 plugin 在运行
- 61 个 skills 可用
- 关键机制：skill-invoker + enforcement hook 强制 skill 调用

## 用户偏好

- 游戏、AI、金融投资
- 喜欢探索新技术
- 不喜欢废话，直来直去
