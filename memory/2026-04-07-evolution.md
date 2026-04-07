# Evolution Progress — 2026-04-07

## 新增 Plugin

### context-monitor (compactWarningHook)

**对应任务**: 0.0 Compact 系统 — `compactWarningHook`（提前警告）

**功能**: 在上下文增长速度过快时，在 `before_compaction` 触发之前主动注入警告。

**实现方式**:
- 使用 `before_prompt_build` 追踪每轮消息数变化（velocity）
- 两个触发条件：
  1. **velocity 警告**：单轮新增消息 >= velocityThreshold（默认 3 条）
  2. **absolute 警告**：总消息数 >= absoluteThreshold（默认 40 条）
- compaction 发生后重置警告标志（5 轮后重新启用）
- 避免重复警告（warningCooldownMs，默认 2 分钟）

**文件**:
- `plugins/context-monitor/index.ts` (223 行)
- `plugins/context-monitor/openclaw.plugin.json`
- `plugins/context-monitor/package.json`

**为什么是低难度 + 有价值**:
- 只用已注册的 hooks，不碰核心
- 填补 `before_compaction` 之前的"预警"空白
- 223 行 < 100 行纯逻辑（注释占约 40%）
