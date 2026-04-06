# 模块一：入口 & 初始化

## 源码路径
- `src/main.tsx` — 主入口（~4600行）
- `src/entrypoints/cli.tsx` — CLI bootstrap 快速路径
- `src/setup.ts` — 工作目录初始化
- `src/entrypoints/init.ts` — init() 初始化逻辑
- `src/replLauncher.tsx` — REPL 启动器

---

## 启动流程（两条路径）

### 路径 A：cli.tsx 快速路径
```
cli.tsx (bootstrap)
  ├── --version              → 直接输出版本，零模块加载
  ├── --dump-system-prompt   → 打印 system prompt 后退出
  ├── --claude-in-chrome-mcp → 启动 Chrome MCP 服务器
  ├── --chrome-native-host   → 启动 Chrome 原生宿主
  ├── --computer-use-mcp     → 启动 Computer Use MCP（ant only）
  ├── --daemon-worker=<kind> → Daemon 工作者进程
  ├── claude remote-control  → 桥接模式（共享本地机器）
  ├── claude daemon          → Daemon 主进程
  ├── claude ps/logs/attach/kill → 会话管理
  ├── claude new/list/reply  → 模板任务
  ├── claude environment-runner → BYOC 环境运行器
  ├── claude self-hosted-runner → 自托管运行器
  ├── --worktree --tmux     → Tmux 工作树快速路径
  └── (以上都不是)           → 加载 main.tsx
```

### 路径 B：main.tsx 完整路径
```
main.tsx::main()
  ├── 前置副作用（模块加载前）
  │   ├── profileCheckpoint('main_tsx_entry')
  │   ├── startMdmRawRead()      — 读取 MDM 配置（macOS）
  │   └── startKeychainPrefetch() — 预取 keychain（OAuth + API key）
  │
  ├── run()
  │   ├── Commander.js 参数解析
  │   │   ├── 全局选项：-p/--print, --model, --agent, --mcp-config
  │   │   │   --permission-mode, --tools, --settings, --verbose
  │   │   │   --continue/--resume, --worktree, --tmux
  │   │   │   等等 60+ 选项
  │   │   └── action handler（主命令）
  │   │
  │   ├── preAction hook（每次命令执行前）
  │   │   ├── await ensureMdmSettingsLoaded()
  │   │   ├── await ensureKeychainPrefetchCompleted()
  │   │   ├── await init() — 完整初始化
  │   │   ├── initSinks() — 日志 sink
  │   │   ├── runMigrations() — 数据迁移
  │   │   └── loadRemoteManagedSettings() / loadPolicyLimits()
  │   │
  │   ├── action handler（主逻辑）
  │   │   ├── parse CLI 选项
  │   │   ├── initializeToolPermissionContext() — 权限上下文
  │   │   ├── setup() — 工作目录设置
  │   │   ├── showSetupScreens() — 信任对话框、登录、 onboarding
  │   │   ├── 创建 Ink Root（交互模式）
  │   │   │   OR runHeadless()（--print 模式）
  │   │   └── REPL 主循环
  │
  └── main() 返回

---

## 关键设计点

### 1. feature() 条件编译
```typescript
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? require('./coordinator/coordinatorMode.js')
  : null
```
通过 `bun:bundle` 的 `feature()` 实现 Dead Code Elimination (DCE)，
内部版本（ant）和外部版本差异极大。

### 2. 并行预取策略
启动时大量并行 fire-and-forget 任务：
- `prefetchSystemContextIfSafe()` — git status
- `prefetchGcpCredentialsIfSafe()` — GCP 认证
- `prefetchFastModeStatus()`
- `countFilesRoundedRg()` — 文件计数
- `initializeAnalyticsGates()` — GrowthBook 特性开关

### 3. MDM / Keychain 预取
```typescript
// 模块加载前就启动 subprocess，节省 ~65ms
startMdmRawRead();       // macOS MDM 配置
startKeychainPrefetch();  // OAuth + legacy API key
```

### 4. 工作目录设置 (setup.ts)
- 找 Git 根目录
- 创建 `.claude/` 目录结构
- 终端备份恢复（iTerm2 / Terminal.app）
- UDS 消息服务器启动
- Teammate 模式快照

### 5. 信任对话框
- 非交互模式（-p）跳过信任确认
- 交互模式必须接受信任对话框才能继续
- 信任接受后才执行 git status 等操作

### 6. 客户端类型判定
```typescript
const clientType = (() => {
  if (isEnvTruthy(GITHUB_ACTIONS)) return 'github-action'
  if (CLAUDE_CODE_ENTRYPOINT === 'sdk-ts') return 'sdk-typescript'
  if (CLAUDE_CODE_ENTRYPOINT === 'sdk-py') return 'sdk-python'
  if (CLAUDE_CODE_ENTRYPOINT === 'sdk-cli') return 'sdk-cli'
  if (CLAUDE_CODE_ENTRYPOINT === 'claude-vscode') return 'claude-vscode'
  if (CLAUDE_CODE_ENTRYPOINT === 'local-agent') return 'local-agent'
  if (CLAUDE_CODE_ENTRYPOINT === 'claude-desktop') return 'claude-desktop'
  if (hasSessionIngressToken) return 'remote'
  return 'cli'
})()
```

### 7. 参数标志早期加载
```typescript
eagerLoadSettings() // 在 init() 之前就解析 --settings / --setting-sources
```

---

## 迁移系统
当前版本 = 11，有 12 个迁移函数：
- `migrateAutoUpdatesToSettings()`
- `migrateSonnet1mToSonnet45()`
- `migrateSonnet45ToSonnet46()`
- `migrateOpusToOpus1m()`
- `migrateFennecToOpus()` (ant only)
- 等等
