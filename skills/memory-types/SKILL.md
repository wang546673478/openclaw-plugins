---
name: memory-types
description: 结构化记忆分类——episodic/semantic/working/project/user 五类
---
# Memory Types Skill

使用结构化格式保存记忆，便于后续检索和分析。

## 记忆类型

| 类型 | 说明 | 使用场景 |
|---|---|---|
| `episodic` | 情景记忆 | 具体的经历、事件、对话 |
| `semantic` | 语义记忆 | 事实、概念、定义 |
| `working` | 工作记忆 | 当前任务、临时信息 |
| `project` | 项目记忆 | 项目的技术决策、架构 |
| `user` | 用户记忆 | 用户的偏好、习惯、背景 |

## 保存格式

```markdown
---
type: <类型>
description: "<简短描述，1句话>"
created: YYYY-MM-DD
tags: [<标签1>, <标签2>]
---

<记忆内容>
```

## 示例

### Episodic（情景记忆）

```markdown
---
type: episodic
description: "用户首次配置 MCP server 的过程"
created: 2026-04-05
tags: [mcp, setup]
---

今天帮助用户配置了一个新的 MCP server。
遇到的问题是认证 token 过期。
解决方案是使用 `openclaw channels login` 重新认证。
```

### Semantic（语义记忆）

```markdown
---
type: semantic
description: "OpenClaw hook 执行顺序"
created: 2026-04-05
tags: [openclaw, hooks]
---

OpenClaw hooks 执行顺序：
1. before_model_resolve
2. before_prompt_build
3. before_agent_start
4. before_tool_call
5. after_tool_call
6. before_agent_reply
7. agent_end
```

### Project（项目记忆）

```markdown
---
type: project
description: "项目架构决策记录"
created: 2026-04-05
tags: [architecture, project-x]
---

技术选型决策：
- 使用 TypeScript 而非 JavaScript（类型安全）
- 采用模块化设计，每个 service 独立
- 数据库选择 SQLite（轻量+本地优先）
```

### User（用户记忆）

```markdown
---
type: user
description: "用户的核心兴趣领域"
created: 2026-04-05
tags: [preferences, user-context]
---

用户牛牛大人的核心兴趣：
1. 游戏（关注 AI+游戏结合）
2. AI（前沿技术和工具）
3. 金融（投资相关）

偏好：直接、高效、不废话的沟通风格。
```

### Working（工作记忆）

```markdown
---
type: working
description: "当前任务的临时状态"
created: 2026-04-05
tags: [current-task]
---

当前正在实现 OpenClaw 的记忆系统。
已完成：SessionMemory、ExtractMemories、AutoDream
进行中：Hook 系统扩展
待完成：MCP Channels 集成
```

## 检索

使用 `memory_search` 时带上 type 过滤：

```
找 type:episodic 的记忆
找关于 project 的记忆
找 user 类型中关于偏好的内容
```

## 注意事项

- `description` 字段是最重要的检索入口，保持简洁
- 每个记忆只聚焦一个主题
- 更新时保留 `created` 时间，只改 `description`
