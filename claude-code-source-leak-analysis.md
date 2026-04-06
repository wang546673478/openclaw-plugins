# Claude Code 源码泄露分析 & 进化清单完整性审查

> 基于 Claude Code v2.1.88 源码（2026-03-30 npm 泄露）+ Web 分析 2026-04-05

---

## 📋 泄露事件概要

| 项目 | 数据 |
|---|---|
| **日期** | 2026-03-30/31 |
| **版本** | v2.1.88 |
| **泄露原因** | npm 包包含了 59.8MB 的 `.map` 源码映射文件 |
| **源码规模** | ~1,884 文件，~512,000 行 TypeScript |
| **暴露位置** | 公开 Cloudflare R2 bucket + npm registry |
| **确认** | Anthropic 工程师 Boris Cherny 确认是开发者错误，非工具漏洞 |

---

## 🔬 源码目录结构

```
src/
├── cli/                    # CLI 入口和传输层
├── coordinator/            # 协调器模式（多 Agent 编排）
├── bridge/                 # 远程桥接（KAIROS 核心）
├── query/                  # 查询引擎
├── tasks/                  # 任务系统（LocalAgentTask, DreamTask...）
├── services/
│   ├── MagicDocs/          # 自动文档更新
│   ├── autoDream/          # 梦境记忆整合
│   ├── awaySummary/         # "离开时"摘要
│   ├── AgentSummary/       # Agent 进度摘要
│   ├── extractMemories/    # 记忆提取
│   ├── SessionMemory/      # 会话记忆
│   ├── PromptSuggestion/   # 主动提示建议
│   ├── compact/            # 三层上下文压缩
│   ├── diagnosticTracking/ # 诊断追踪
│   ├── teamMemorySync/     # 团队内存同步
│   ├── mcp/                # MCP 通道通知（Channels！）
│   │   └── channelNotification.ts  # KAIROS Channels 核心
│   └── ...
├── tools/                  # 60+ 内置工具
│   ├── SleepTool/          # KAIROS 睡眠/唤醒
│   ├── WebBrowserTool/     # 浏览器自动化
│   ├── AgentTool/         # Agent 调度
│   ├── TeamCreateTool/    # 团队创建
│   └── ...
├── buddy/                  # BUDDY 虚拟宠物系统！
│   ├── companion.ts        # 宠物生成
│   └── sprites.ts          # ASCII 动画精灵
└── ...
```

---

## 🚨 进化清单完整性审查结果

### ❌ `openclaw-claude-code-exact-mapping.md` 严重遗漏

该文档聚焦于 **10 个核心 Pattern** 的可实现性分析，但**完全遗漏了大量重要功能**：

---

### 遗漏 1：KAIROS — 永久后台 Agent ⭐⭐⭐⭐⭐

**这是泄露中最重大的未发布功能！**

```typescript
// feature('KAIROS') 控制
// 5 大机制协同：
// 1. Tick Loop — setTimeout(0) 注入消息，模型自行决定行动或睡眠
// 2. SleepTool — 每唤醒一次耗费 API 调用，缓存 5 分钟过期
// 3. 15 秒阻塞预算 — shell 命令超 15s 自动后台化
// 4. SendUserMessage — 后台 Agent 不向 stdout 打印
// 5. Channel 通知 — Discord/Telegram 等外部事件推入对话
```

**源码证据**（channelNotification.ts）：
```typescript
// feature('KAIROS') || feature('KAIROS_CHANNELS')
// Runtime gate tengu_harbor
// Requires claude.ai OAuth auth — API key users are blocked
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 2：Channels — MCP 外部事件通道 ⭐⭐⭐⭐

```typescript
// 外部事件（Telegram, Discord, webhooks, CI 失败）推入运行中的 Claude Code
// 通过 MCP server 实现：
// - 暴露发送工具（send_message）
// - 接收 notifications/claude/channel 通知
// 需求：claude.ai OAuth，API key 用户被阻止
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 3：ULTRAPLAN — 云端规划 ⭐⭐⭐

```typescript
feature('ULTRAPLAN')
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 4：Coordinator Mode — 多 Agent 协调 ⭐⭐⭐

```typescript
// src/coordinator/coordinatorMode.ts
// CLAUDE_CODE_COORDINATOR_MODE 环境变量控制
// 多 Agent 编排模式
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 5：Agent Triggers — 定时触发器 ⭐⭐⭐

```typescript
// src/cli/print.ts
feature('AGENT_TRIGGERS')  // cron 调度
feature('AGENT_TRIGGERS_REMOTE')  // 远程触发
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 6：VERIFICATION_AGENT — 验证 Agent ⭐⭐

```typescript
feature('VERIFICATION_AGENT')
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 7：ANTI_DISTILLATION_CC — 反蒸馏 ⭐⭐

```typescript
feature('ANTI_DISTILLATION_CC')
// 向 API 请求注入假工具，防止竞争对手提取模型行为
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 8：SleepTool — KAIROS 专用 ⭐⭐⭐

```typescript
// tools/SleepTool/
// KAIROS 的核心机制：模型自己决定何时睡眠/唤醒
// 每次唤醒耗费 API 调用，缓存 5 分钟过期
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 9：WebBrowserTool — 浏览器自动化 ⭐⭐⭐

```typescript
feature('WEB_BROWSER_TOOL')
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 10：teamMemorySync — 团队共享内存 ⭐⭐

```typescript
// src/services/teamMemorySync/
// 团队多个 Claude Code 实例共享内存
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 11：Away Summary — "离开时"摘要 ⭐⭐

```typescript
// src/services/awaySummary.ts
// 用户离开后回来，显示 1-3 句会话摘要
// 用途：快速回到上下文
```

**映射状态**：❌ 完全遗漏（SessionMemory 相关但不等价）

---

### 遗漏 12：diagnosticTracking — 诊断追踪 ⭐⭐

```typescript
// src/services/diagnosticTracking.ts
// 完整诊断追踪系统
```

**映射状态**：❌ 完全遗漏

---

### 遗漏 13：BUDDY — 虚拟宠物伴侣 ⭐⭐⭐⭐

```typescript
// src/buddy/
// 18+ 物种（duck, cat, dragon, ghost...）
// 稀有度系统 + ASCII 动画 + 帽子/眼睛自定义
// 不是玩具——让 AI"有实体感"
```

**状态**：在 `openclaw-evolution-tasks.md` 中有记录 ✅

---

### 遗漏 14：Undercover Mode — 隐形模式 ⭐⭐

```typescript
// USER_TYPE === 'ant' 检测
// 让 Anthropic 员工贡献开源项目时不暴露 AI 作者身份
// 提交信息："never include the phrase 'Claude Code' or any mention that you are an AI"
```

**状态**：在 `openclaw-evolution-tasks.md` 中有记录 ✅

---

## 📊 完整 Feature Flag 清单（89 个）

```
AGENT_MEMORY_SNAPSHOT     AGENT_TRIGGERS          AGENT_TRIGGERS_REMOTE
ALLOW_TEST_VERSIONS       ANTI_DISTILLATION_CC    AUTO_THEME
AWAY_SUMMARY             BASH_CLASSIFIER          BG_SESSIONS
BREAK_CACHE_COMMAND       BRIDGE_MODE             BUDDY
BUILDING_CLAUDE_APPS      BUILTIN_EXPLORE_PLAN_AGENTS
CACHED_MICROCOMPACT       CCR_AUTO_CONNECT        CCR_MIRROR
CCR_REMOTE_SETUP          CHICAGO_MCP             COMMIT_ATTRIBUTION
COMPACTION_REMINDERS      CONNECTOR_TEXT          CONTEXT_COLLAPSE
COORDINATOR_MODE          COWORKER_TYPE_TELEMETRY  DAEMON
DOWNLOAD_USER_SETTINGS    ENHANCED_TELEMETRY_BETA  EXPERIMENTAL_SKILL_SEARCH
EXTRACT_MEMORIES          FILE_PERSISTENCE        FORK_SUBAGENT
HARD_FAIL                HISTORY_PICKER           HISTORY_SNIP
IS_LIBC_GLIBC            IS_LIBC_MUSL            KAIROS
KAIROS_BRIEF             KAIROS_CHANNELS         KAIROS_DREAM
KAIROS_GITHUB_WEBHOOKS   KAIROS_PUSH_NOTIFICATION LODESTONE
MCP_SKILLS              MEMORY_SHAPE_TELEMETRY   MESSAGE_ACTIONS
MONITOR_TOOL             NATIVE_CLIENT_ATTESTATION NATIVE_CLIPBOARD_IMAGE
NEW_INIT                OVERFLOW_TEST_TOOL       PERFETTO_TRACING
POWERSHELL_AUTO_MODE     PROACTIVE              PROMPT_CACHE_BREAK_DETECTION
QUICK_SEARCH             REACTIVE_COMPACT        REVIEW_ARTIFACT
RUN_SKILL_GENERATOR      SHOT_STATS             SKILL_IMPROVEMENT
SLOW_OPERATION_LOGGING   STREAMLINED_OUTPUT      TEAMMEM
TEMPLATES               TERMINAL_PANEL           TOKEN_BUDGET
TORCH                   TRANSCRIPT_CLASSIFIER    TREE_SITTER_BASH
TREE_SITTER_BASH_SHADOW  UDS_INBOX              ULTRAPLAN
ULTRATHINK               UNATTENDED_RETRY        UPLOAD_USER_SETTINGS
VERIFICATION_AGENT       VOICE_MODE              WEB_BROWSER_TOOL
WORKFLOW_SCRIPTS
```

---

## ✅ `openclaw-evolution-tasks.md` 覆盖情况

该文件补充记录了以下功能（标注 ⭐ 的为重要）：

| 功能 | 覆盖 |
|---|---|
| BUDDY 虚拟宠物 | ✅ |
| CLI Agents | ✅ |
| Analytics/Telemetry ⭐ | ✅ |
| Hooks 完整版（4923行）⭐ | ✅ |
| Memory 类型系统 ⭐ | ✅ |
| IDE 集成 ⭐⭐⭐ | ✅ |
| Code Indexing ⭐ | ✅ |
| Direct Connect | ✅ |
| Clipboard/Selection | ✅ |
| Color Diff | ✅ |
| Scheduling/Cron | ✅ |
| Background Tasks | ✅ |
| Voice I/O | ✅ |
| Login/Auth | ✅ |
| Plugin Architecture | ✅ |
| Chrome Extension | ✅ |
| Auto Mode | ✅ |
| Settings Sync | ✅ |
| Prevent Sleep | ✅ |
| Billing | ✅ |
| Magic Docs | ✅（在 mapping 中也有） |
| Away Summary | ❌ |
| teamMemorySync | ❌ |
| diagnosticTracking | ❌ |

---

## 📝 最终结论

### `openclaw-claude-code-exact-mapping.md` 进化清单**不完整**

**缺失的关键功能**：

| 优先级 | 功能 | 说明 |
|---|---|---|
| 🔴 P0 | **KAIROS** | always-on 后台 agent，泄露最大亮点 |
| 🔴 P0 | **Channels** | MCP 外部事件通道（Discord/Telegram） |
| 🔴 P0 | **ULTRAPLAN** | 云端规划 |
| 🟠 P1 | **Coordinator Mode** | 多 agent 编排 |
| 🟠 P1 | **Agent Triggers** | 定时触发（cron） |
| 🟡 P2 | **VERIFICATION_AGENT** | 验证 agent |
| 🟡 P2 | **ANTI_DISTILLATION_CC** | 反蒸馏保护 |
| 🟡 P2 | **SleepTool** | KAIROS 核心机制 |
| 🟡 P2 | **WebBrowserTool** | 浏览器自动化 |
| 🟡 P2 | **Away Summary** | 离开摘要 |
| 🟡 P2 | **teamMemorySync** | 团队共享内存 |
| 🟡 P2 | **diagnosticTracking** | 诊断追踪 |

### 建议

1. **将 KAIROS + Channels 作为最高优先级** — 这是 Claude Code 转向"always-on"AI Agent 的核心架构
2. **分离两个文档的职责**：
   - `openclaw-claude-code-exact-mapping.md` → 专注于 OpenClaw 可实现性分析
   - `openclaw-claude-code-features.md` → 完整的 Claude Code 功能清单（不分是否已实现）
3. **将 BUDDY、Away Summary、teamMemorySync、diagnosticTracking 加入进化清单**
