# 模块二：Agent 核心循环（QueryEngine）

## 源码路径
- `src/QueryEngine.ts` — 核心查询引擎（~1300行）
- `src/query.ts` — 低层 HTTP API 请求封装
- `src/coordinator/coordinatorMode.ts` — 协调者模式

---

## QueryEngine 架构

### 类设计
```typescript
export class QueryEngine {
  private config: QueryEngineConfig
  private mutableMessages: Message[]      // 会话消息历史
  private abortController: AbortController
  private permissionDenials: SDKPermissionDenial[]
  private totalUsage: NonNullableUsage    // API 使用量统计
  private readFileState: FileStateCache  // 文件读取缓存
  private discoveredSkillNames: Set<string>
  private loadedNestedMemoryPaths: Set<string>
}
```

### submitMessage() — 核心循环

```typescript
async *submitMessage(
  prompt: string | ContentBlockParam[],
  options?: { uuid?: string; isMeta?: boolean }
): AsyncGenerator<SDKMessage, void, unknown>
```

**输入**：
- `prompt` — 用户输入（字符串或结构化 ContentBlock）
- 返回 **AsyncGenerator<SDKMessage>** — 流式输出

**流程**：

```
1. fetchSystemPromptParts()
   ├── 获取 defaultSystemPrompt
   ├── 获取 userContext（工作目录、git、分支等）
   ├── 获取 systemContext（已修改文件、任务等）
   └── 注入 memoryMechanicsPrompt（如果设置了自定义 memory 路径）

2. processUserInput()
   ├── 解析 slash commands（如 /test, /commit）
   ├── 处理 attachments
   ├── 检查权限
   └── 返回允许的工具列表

3. API 查询循环（for await...of query()）
   ├── 组装 messages[]
   ├── 发送到 Anthropic API
   ├── 处理 stream 事件
   └── 处理 tool_use 请求

4. 工具执行
   ├── 权限检查
   ├── 查找工具实现
   ├── 执行工具
   └── 将结果转成 assistant 消息

5. 循环直到 end_turn 或 max_turns

6. 记录 transcript
7. 更新 usage 统计
```

### API 层（query.ts）

```typescript
async function query(params: {
  cwd: string
  messages: Message[]
  systemPrompt: SystemPrompt
  tools: Tool[]
  model: string
  thinkingConfig: ThinkingConfig
  abortSignal: AbortSignal
  ...
}): Promise<AsyncGenerator<StreamEvent>>
```

- 使用 `@anthropic-ai/sdk` 的 Messages API
- 支持 `max_tokens`、`temperature` 等参数
- 内置重试逻辑（429 Rate Limit）
- 处理 `PROMPT_TOO_LONG` 错误

### 工具执行流程

```
API 返回 tool_use → 提取工具名 + 参数
  → canUseTool() 权限检查
    → 查找工具实现（BashTool、FileEditTool 等）
      → 执行工具（spawn 子进程或直接调用）
        → 捕获输出/错误
          → 转成 assistant message
            → 追加到 messages[]
              → 继续 API 循环
```

### 消息历史管理

- `mutableMessages[]` — 保存整个会话历史
- 支持 **compact（压缩）**：历史过长时压缩旧消息
  - `snipModule` — HISTORY_SNIP 特性
  - `reactiveCompact` — REACTIVE_COMPACT 特性
  - `contextCollapse` — CONTEXT_COLLAPSE 特性
- Compact 后生成 replay prompt 保持上下文

### 协调者模式（COORDINATOR_MODE）

```typescript
const getCoordinatorUserContext: (
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
) => { [k: string]: string } = feature('COORDINATOR_MODE')
  ? require('./coordinator/coordinatorMode.js').getCoordinatorUserContext
  : () => ({})
```

Coordinator 模式下：
- 多个 Agent 被协调者管理
- 工具列表被协调者过滤
- Scratchpad 目录用于 agent 间通信

---

## 关键设计

### 1. AsyncGenerator 流式输出
`submitMessage()` 是 `AsyncGenerator<SDKMessage>`，实时 yield：
- `assistant` — assistant 回复
- `user` — replay 的 user 消息
- `tool_use` — 工具调用
- `sdk_compact_boundary` — 压缩边界
- `sdk_status` — 状态更新

### 2. 权限模型
```typescript
wrappedCanUseTool() // 包装权限检查
  → 允许 → 执行工具
  → 拒绝 → 记录到 permissionDenials + 通知 SDK
```

### 3. 多模型支持
```typescript
userSpecifiedModel
  ? parseUserSpecifiedModel(userSpecifiedModel)
  : getMainLoopModel()
```
- 支持模型别名（`sonnet`, `opus`）
- 支持 fallback model
- 支持 `taskBudget`（API 侧预算控制）

### 4. Thinking 配置
```typescript
initialThinkingConfig = thinkingConfig
  ?? (shouldEnableThinkingByDefault() !== false
    ? { type: 'adaptive' }
    : { type: 'disabled' })
```
- `adaptive` — 模型自适应
- `enabled` — 强制开启，指定 `budgetTokens`
- `disabled` — 关闭

### 5. 工具使用追踪
- `countToolCalls()` — 统计工具调用次数
- `generateToolUseSummary()` — 生成工具调用摘要
- `SYNTHETIC_MESSAGES` — 合成消息（工具结果摘要等）

---

## compact（压缩）机制

当消息历史过长时，有多层压缩策略：

1. **Auto Compact**：自动检测并压缩
2. **Snip**（HISTORY_SNIP）：删除中间消息但保留结构
3. **Context Collapse**（CONTEXT_COLLAPSE）：折叠上下文
4. **Replay**：压缩后生成 replay prompt 让模型恢复上下文

```typescript
const { messages: compactedMessages } = buildPostCompactMessages(
  originalMessages,
  compactBoundaryIndex
)
```
