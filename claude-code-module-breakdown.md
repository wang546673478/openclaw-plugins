# Claude Code 源码大功能模块划分

> 版本：claude-code-2.1.88
> 源码路径：`/home/hhhh/claude-code-sourcemap-main/restored-src/src/`

---

## 十大功能模块

```
【A】Agent Harness Core          — Agent 核心运行时
【B】Agent Memory & Context    — 记忆与上下文
【C】Agent Collaboration        — 多 Agent 协作
【D】System Infrastructure      — 系统基础设施
【E】CLI Interface              — 命令行接口
【F】Bridge / Remote            — 远程连接层
【G】UI Layer                  — 终端 UI 组件
【H】Platform Integrations      — 平台集成
【I】Skills System             — 技能系统
【J】Utils                     — 共享工具函数
```

---

## 完整归属表

共 53 个目录/文件，全部有明确归属。

### 【A】Agent Harness Core（11 个）

| 目录/文件 | 说明 |
|---|---|
| `QueryEngine.ts` | 主查询引擎，核心循环 |
| `query.ts` | API 查询封装 |
| `query/` | API 查询实现 |
| `Task.ts` | 任务抽象定义 |
| `tasks.ts` | 任务类型 |
| `tasks/` | 任务实现（LocalShell/LocalAgent/InProcess/Remote/Dream） |
| `Tool.ts` | 工具基类 |
| `tools.ts` | 工具注册表 |
| `tools/` | 40+ 工具实现 |
| `entrypoints/agentSdkTypes.ts` | SDK 类型定义 |
| `entrypoints/sdk/` | SDK 类型 |

### 【B】Agent Memory & Context（3 个）

| 目录/文件 | 说明 |
|---|---|
| `context.ts` | 上下文组装 |
| `context/` | 上下文 helpers |
| `memdir/` | MEMORY.md 系统、记忆类型、扫描 |

### 【C】Agent Collaboration（1 个）

| 目录/文件 | 说明 |
|---|---|
| `coordinator/` | 协调者模式 |

### 【D】System Infrastructure（15 个）

| 目录/文件 | 说明 |
|---|---|
| `bootstrap/` | 启动状态初始化 |
| `constants/` | 常量定义、System Prompt、工具常量 |
| `types/` | TypeScript 类型定义 |
| `schemas/` | Zod Schema 定义 |
| `hooks.ts` | Hook 类型定义 |
| `entrypoints/mcp.ts` | MCP 服务器入口 |
| `entrypoints/init.ts` | 初始化 |
| `entrypoints/sandboxTypes.ts` | 沙箱类型 |
| `services/api/` | Anthropic API 调用、重试、错误处理 |
| `services/mcp/` | MCP 客户端、配置、OAuth、官方注册表 |
| `services/oauth/` | OAuth |
| `services/analytics/` | 遥测、GrowthBook 特性开关 |
| `services/plugins/` | 插件系统 |
| `services/lsp/` | LSP 集成 |
| `services/policyLimits/` | 策略限制 |
| `services/notifier.ts` | 通知 |
| `migrations/` | 数据迁移（12 个迁移函数） |
| `upstreamproxy/` | API 代理 |
| `cost-tracker.ts` | Token 使用量、费用追踪 |
| `plugins/` | 插件加载器 |

### 【E】CLI Interface（8 个）

| 目录/文件 | 说明 |
|---|---|
| `main.tsx` | 主入口 |
| `cli.tsx` | 快速路径入口 |
| `cli/` | CLI 子命令处理器 |
| `cli/transports/` | 传输层（WebSocket/SSE） |
| `commands.ts` | 命令注册表 |
| `commands/` | 80+ 子命令（commit/diff/review/mcp/skills 等） |
| `history.ts` | 命令历史管理（ctrl+r/up-arrow） |
| `replLauncher.tsx` | REPL 启动器 |
| `setup.ts` | 工作目录初始化、信任对话框 |

### 【F】Bridge / Remote（3 个）

| 目录/文件 | 说明 |
|---|---|
| `bridge/` | 桥接模式（共享本地机器给远程） |
| `remote/` | 远程会话管理、SDK 控制协议 |
| `server/` | 直连服务器 |

### 【G】UI Layer（16 个）

| 目录/文件 | 说明 |
|---|---|
| `ink.ts` | Ink 入口 |
| `ink/` | Ink 组件库（layout/events/hooks/termio） |
| `components/` | React 组件（PromptInput/Settings/Diff/Messages 等） |
| `screens/` | 全屏界面（OOBE 等） |
| `state/` | UI 状态（100+ use*.ts/tsx） |
| `hooks/` | UI 状态 hooks（非 lifecycle） |
| `assistant/` | Assistant UI（sessionHistory/mailbox/notifications） |
| `outputStyles/` | 输出样式 |
| `keybindings/` | 键盘快捷键 |
| `costHook.ts` | 费用显示 hook |
| `dialogLaunchers.tsx` | 对话框 |
| `interactiveHelpers.tsx` | 交互 helpers |
| `projectOnboardingState.ts` | 引导状态 |

### 【H】Platform Integrations（5 个）

| 目录/文件 | 说明 |
|---|---|
| `buddy/` | 虚拟宠物伴侣（物种/属性/ASCII sprite 动画） |
| `voice/` | 语音输入输出、关键词检测 |
| `vim/` | Vim 集成 |
| `moreright/` | MoreRight 集成 |
| `native-ts/` | 原生优化（color-diff/file-index/yoga-layout） |

### 【I】Skills System（1 个）

| 目录/文件 | 说明 |
|---|---|
| `skills/` | 技能定义与加载 |
| `skills/bundled/` | 内置技能 |

### 【J】Utils（1 个）

| 目录/文件 | 说明 |
|---|---|
| `utils/` | 共享工具函数（abort/file/permissons/shell/telemetry 等 50+） |

---

## 模块关系图

```
                    ┌─────────────────────────────────────┐
                    │  【E】CLI Interface                  │
                    │  main.tsx / commands/ / history.ts   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │  【D】System Infrastructure           │
                    │  bootstrap / constants / types /    │
                    │  services/api / services/mcp /       │
                    │  services/analytics / migrations /   │
                    │  upstreamproxy / cost-tracker /      │
                    │  entrypoints/ / schemas / plugins /   │
                    └──────────────┬──────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         ▼                         ▼                         ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│  【A】Harness Core   │ │  【B】Memory/Context │ │  【C】Collaboration │
│  QueryEngine +      │ │  memdir/ + compact/  │ │  coordinator/ +     │
│  tools/ + tasks/    │ │  tokenEstimation /   │ │  tasks/ +           │
│  query/ + entrypoints│ │  autoDream/          │ │  AgentTool/         │
│  (SDK types)         │ │  SessionMemory /     │ │  SendMessageTool /   │
│                     │ │  extractMemories/    │ │  BriefTool /        │
└─────────────────────┘ └─────────────────────┘ │  AgentSummary /      │
                           ▲                  │  PromptSuggestion    │
                           │                  └─────────────────────┘
                           │
         ┌─────────────────┴─────────────────────────┐
         │  【I】Skills System                       │
         │  skills/ + utils/skills/                 │
         └─────────────────┬─────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────────┐
│  【G】UI Layer                                                    │
│  ink/ + components/ + state/ + hooks/ + screens/ + assistant/   │
│  outputStyles/ + keybindings/ + costHook / dialogLaunchers /     │
│  interactiveHelpers / projectOnboardingState                      │
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │
┌──────────────────────────┴──────────────────────────┐
│  【F】Bridge / Remote                               │
│  bridge/ + remote/ + server/                        │
└────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  【H】Platform Integrations                          │
│  buddy/ + voice/ + vim/ + moreright/ + native-ts/   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  【J】Utils                                        │
│  utils/ (shared utilities)                          │
└─────────────────────────────────────────────────────┘
```

---

## 统计

| 模块 | 数量 |
|---|---|
| 【A】Agent Harness Core | 11 |
| 【B】Agent Memory & Context | 3 |
| 【C】Agent Collaboration | 1 |
| 【D】System Infrastructure | 15 |
| 【E】CLI Interface | 8 |
| 【F】Bridge / Remote | 3 |
| 【G】UI Layer | 16 |
| 【H】Platform Integrations | 5 |
| 【I】Skills System | 1 |
| 【J】Utils | 1 |
| **合计** | **53** |

---

## 核心结论

Claude Code 的架构是：

- **Agent Harness Core（【A】）** 是真正可移植到 OpenClaw 的部分
- **【D】System Infrastructure** 是 Claude Code 的平台层（Anthropic API、GrowthBook、自有 MCP 生态）
- **【G】UI Layer** 是 Claude Code 作为本地 CLI 工具的展现层（Ink React）
- **【E】CLI / 【F】Bridge / 【H】Platform** 是 Claude Code 的差异化特性，非通用 Agent 框架

**对 OpenClaw 最有参考价值的模块**：【A】、【B】、【C】、【I】（Skills）