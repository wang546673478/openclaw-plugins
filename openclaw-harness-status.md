# OpenClaw Harness 完整度报告

> 日期：2026-04-07
> 更新：2026-04-07 12:04（新增 model-router plugin）

---

## 总体状态

```
P0 核心     7/7  ✅  100%
P1 差异化   3/5  🟡  60%
P2 Hooks   2/2  🟡  75%
P3 Remote  2/3  🟡  67%
P4 辅助     3/4  🟡  75%

总体        14/20 ✅  70%
            +5/20 🟡  25%
            +1/20 ❌   5%  (架构性限制)
```

---

## Plugin 矩阵（14个）

| Plugin | Hooks/Tools | 功能 | 对应任务 |
|--------|------------|------|---------|
| agent-hooks | 9 hooks | lifecycle hooks + skill enforcement | 0.0 Compact |
| analytics | 2 hooks | 工具使用统计 | 5.1 Analytics |
| session-save | agent_end | 会话摘要+决策提取 | 1.2 ExtractMemories |
| subagent-aggregate | 2 hooks | subagent 结果聚合 | 协作 |
| code-change | after_tool_call | git 检测+test/lint 验证 | 2.4 VERIFICATION |
| scheduled-tasks | session_start | 定时任务 prependContext | 1.5 Agent Triggers |
| brief-tool | agent_end | 1-3句会话摘要 | 1.4 BriefTool |
| away-summary | session_start+end | 离开摘要+注入 | 5.3 Away Summary |
| http-inject | HTTP routes+hooks | HTTP webhook→事件注入 | 4.2 KAIROS |
| coordinator | 4 tools | 多 agent 协调工具 | 2.1 Coordinator |
| agent-snapshot | subagent_ended | subagent 快照 | 2.3 Agent Snapshot |
| skill-invoker | skill tool | 强制 skill 调用 | using-superpowers |
| verification-agent | after_tool_call+tools | 自动验证代码变更 | 2.4 VERIFICATION |
| model-router | before_model_resolve | 模型/提供商路由 | 1.6 Tool Search / P2 Hooks |

---

## Skills（61个可用）

| 来源 | 数量 | 路径 |
|------|------|------|
| workspace skills | 8 | `~/.openclaw/workspace/skills/` |
| bundled skills | 53 | `~/.npm-global/.../openclaw/skills/` |
| **总计** | **61** | |

### Workspace Skills（8个）
- agent-snapshot
- auto-dream
- coordinator
- cron-wake
- memory-types
- scheduled-check
- using-superpowers
- verification

---

## OpenClaw 内置能力（重要对照）

### 内置 Bundled Hooks（4个）

| Hook | 触发 | 功能 | 与我们的 Plugin 关系 |
|------|------|------|------------------|
| session-memory | `/new`, `/reset` | 自动保存会话摘要到 memory/ | 与 session-save 功能重叠，触发时机不同，可并存 |
| bootstrap-extra-files | agent:bootstrap | 注入额外 bootstrap 文件 | 互补 |
| command-logger | command | 记录命令到 audit log | 与 code-change 互补 |
| boot-md | gateway:startup | 启动时运行 BOOT.md | 互补 |

### 内置记忆系统

| 能力 | 说明 | 我们的对应 |
|------|------|----------|
| 三层记忆 | MEMORY.md + memory/YYYY-MM-DD.md + SQLite | ✅ 等价实现 |
| Auto memory flush | compaction 前自动提醒保存 | ✅ HEARTBEAT 机制 |
| memory_search | 向量+关键词混合搜索 | ✅ 已有 |
| memory_get | 读取指定 memory 文件 | ✅ 已有 |
| session-memory hook | /new 或 /reset 时保存摘要 | 与 session-save 各有触发时机 |

### 内置工具

| 工具 | 说明 |
|------|------|
| sessions_spawn | 启动 subagent |
| sessions_send | 发送消息到其他 session |
| memory_search | 搜索记忆 |
| Skill 工具 | ❌ 不存在（需要 skill-invoker plugin）|

---

## Skill 机制三层互补

| 机制 | 提供 |
|------|------|
| OpenClaw 内置 | skill 名称 + 描述 → system prompt |
| skill 工具（skill-invoker） | 完整 SKILL.md 内容 |
| enforcement hook | 强制提醒调用 |

---

## 路径修复记录（2026-04-06 16:20）

### 问题
plugin 用 `process.cwd()` 写到 `$HOME/memory/`，但 workspace 是 `~/.openclaw/workspace/`

### 修复
5个 plugin 修复路径计算，迁移旧文件到正确位置：
- session-save ✅
- brief-tool ✅
- away-summary ✅
- agent-snapshot ✅
- code-change ✅

---

## 进化清单详情

### P0 — 核心 ✅

| 任务 | 状态 | 实现 |
|------|------|------|
| 0.0 Compact 系统 | 🟡 60% | agent-hooks before/after_compaction |
| 1.1 SessionMemory | ✅ | HEARTBEAT + session-save |
| 1.2 ExtractMemories | ✅ | session-save 决策提取 |
| 1.3 AutoDream | ✅ | auto-dream skill |
| 1.4 BriefTool | ✅ | brief-tool plugin |
| 1.5 Agent Triggers | ✅ | scheduled-tasks + cron |
| 1.6 Tool Search | ✅ | SKILL.md 等价 |

### P1 — 差异化核心

| 任务 | 状态 | 实现 |
|------|------|------|
| 2.1 Coordinator | ✅ | coordinator plugin |
| 2.2 Fork-Join Cache | ❌ | 架构性不兼容 |
| 2.3 Agent Snapshot | ✅ | agent-snapshot plugin |
| 2.4 VERIFICATION | ✅ | code-change + test/lint |
| 2.5 Anti-Distillation | ❌ | 无意义 |

### P2 — Hooks + 类型

| 任务 | 状态 | 实现 |
|------|------|------|
| 3.1 Hooks 系统 | 🟡 75% | 13/17 hooks |
| 3.2 Memory 类型 | ✅ | memory-types skill |

### P3 — Remote + MCP

| 任务 | 状态 | 实现 |
|------|------|------|
| 4.1 RemoteSession | 🟡 | ACP remote 部分等价 |
| 4.2 MCP Channels | ✅ | http-inject plugin |
| 4.3 MCP OAuth | ❌ | 架构性 |

### P4 — 辅助

| 任务 | 状态 | 实现 |
|------|------|------|
| 5.1 Analytics | 🟡 | 有基础，缺 GrowthBook |
| 5.2 Background Tasks | 🟡 | tasks 系统 |
| 5.3 Away Summary | ✅ | away-summary plugin |
| 5.4 teamMemorySync | ❌ | 无意义 |

---

## 关键文件

- `openclaw-evolution-tasks.md` — 进化任务清单
- `openclaw-source-analysis.md` — 源码分析报告
- `openclaw-plugin-opportunities.md` — Plugin 机会矩阵
- `openclaw-harness-status.md` — 本文档
