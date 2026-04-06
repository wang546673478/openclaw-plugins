# 模块五：命令系统 & 协作

## 源码路径
- `src/commands.ts` — 命令注册表（~800行）
- `src/commands/` — 80+ 个子命令目录

---

## 命令分类

### 本地命令（local 类）
| 命令 | 说明 |
|---|---|
| `claude add-dir` | 添加额外工作目录 |
| `claude branch` | Git 分支管理 |
| `claude clear` | 清屏 |
| `claude compact` | 压缩会话历史 |
| `claude config` | 配置管理 |
| `claude diff` | Git diff |
| `claude doctor` | 诊断健康状况 |
| `claude files` | 文件统计 |
| `claude init` | 初始化项目 |
| `claude login/logout` | 认证管理 |
| `claude memory` | 记忆管理 |
| `claude model` | 模型选择 |
| `claude mcp` | MCP 服务器管理 |
| `claude permissions` | 权限管理 |
| `claude plan` | 计划模式 |
| `claude resume` | 恢复会话 |
| `claude session` | 会话管理 |
| `claude skills` | 技能管理 |
| `claude status` | 当前状态 |
| `claude theme` | 主题设置 |
| `claude version` | 版本信息 |

### Prompt 类（slash commands）
| 命令 | 说明 |
|---|---|
| `/commit` | Git commit |
| `/diff` | 显示 diff |
| `/review` | 代码审查 |
| `/test` | 生成测试 |
| `/btw` | 顺便说 |
| `good-claude` | 表扬 Claude |
| `issue` | GitHub Issue 操作 |
| `pr_comments` | PR 评论 |
| `security-review` | 安全审查 |
| `autofix-pr` | 自动修复 PR |

### Agent 协作类
| 命令/模块 | 说明 |
|---|---|
| `claude agents` | Agent 管理 |
| `claude buddy` | BUDDY 模式 |
| `claude fork` | FORK_SUBAGENT |
| `claude team` | TeamCreateTool/TeamDeleteTool |
| `claude peers` | UDS_INBOX |
| `claude workflow` | 工作流脚本 |

### 开发者/调试类
| 命令 | 说明 |
|---|---|
| `claude debug-tool-call` | 调试工具调用 |
| `claude heapdump` | 堆转储 |
| `claude hooks` | Hook 管理 |
| `claude plugin` | 插件管理 |
| `claude reload-plugins` | 重载插件 |
| `claude rewind` | 回退会话 |
| `claude perf-issue` | 性能问题诊断 |
| `claude ant-trace` | Ant 追踪 |

---

## 命令注册机制

```typescript
// commands.ts 中注册命令
const commands: Command[] = [
  addDir, autofixPr, backfillSessions, btw, goodClaude, issue,
  feedback, clear, color, commit, copy, desktop, commitPushPr,
  compact, config, context, cost, diff, ctx_viz, doctor,
  memory, help, ide, init, initVerifiers, keybindings,
  login, logout, installGitHubApp, installSlackApp,
  breakCache, mcp, mobile, onboarding, pr_comments,
  releaseNotes, rename, resume, review, session, share,
  skills, status, tasks, teleport, ...
]

export { commands }
```

### Command 类型

```typescript
export type Command = {
  name: string           // 命令名
  description: string
  action: (args: string[]) => Promise<void>  // 执行函数
  // 子命令支持
  commands?: Command[]
}
```

---

## 协作功能（Agent Swarms）

### 进程内 Teammate
- 在主进程内直接运行 Agent
- 零 IPC 开销
- 通过内存直接通信

### SendMessageTool
- Agent 间消息传递
- 格式：`{ to: agentId, content: string }`

### TeamCreateTool / TeamDeleteTool
- 动态创建/销毁 Agent 团队
- 团队成员通过 MCP 协议通信

### UDS Inbox（ListPeersTool）
- Unix Domain Socket 消息队列
- 进程间消息通知

---

## 协调者模式（Coordinator Mode）

```typescript
// 多个 Agent 由协调者管理
// 协调者决定：
// - 谁执行什么任务
// - 工具访问权限过滤
// - 消息路由

// 特性标志
feature('COORDINATOR_MODE')
```

---

## 桥接模式（Bridge Mode）

```typescript
// claude remote-control / rc / bridge
// 将本地机器作为桥接环境暴露给远程 Claude
feature('BRIDGE_MODE')

// 相关配置
checkBridgeMinVersion()
getBridgeDisabledReason()
isPolicyAllowed('allow_remote_control')
```

---

## 主动模式（Proactive / KAIROS）

```typescript
// Proactive mode: Agent 主动行动
// 周期性 <tick> 触发检查
feature('PROACTIVE')

// KAIROS: 增强的主动模式
feature('KAIROS')

// Sleep 工具
feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null
```
