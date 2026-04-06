# OpenClaw 功能详细文档

> 基于源码 + 官方文档
> 版本：latest
> 源码路径：`/home/hhhh/.npm-global/lib/node_modules/openclaw/`

---

## 一、核心定位

**OpenClaw** 是一个**自托管的多通道 AI Agent 网关**：

- 把 AI coding agent（内置 Pi agent runtime）连接到 WhatsApp、Telegram、Discord、iMessage 等聊天平台
- 支持多 Agent 路由、会话管理、工具扩展和插件生态
- 运行在用户自己的硬件上，数据完全自控

---

## 二、架构概览

### 核心组件

```
OpenClaw Gateway (单一长期进程)
  │
  ├── 聊天平台连接（WhatsApp/Telegram/Discord/iMessage 等）
  │
  ├── WebSocket API（Typed RPC）
  │     ├── 控制平面：macOS app / CLI / Web UI / Automations
  │     └── 节点平面：iOS / Android / macOS / Headless 节点
  │
  ├── Pi Agent Runtime（内置）
  │     ├── 模型调用（35+ provider）
  │     ├── 工具系统
  │     └── Prompt 管道
  │
  ├── 记忆系统（Multiple backend）
  │     ├── memory-core（默认 SQLite）
  │     ├── memory-qmd（本地 sidecar）
  │     └── memory-honcho（AI-native）
  │
  └── 插件系统（Channels / Providers / Tools / Skills / Hooks）
```

---

## 三、通道系统（Channels）

### 3.1 内置通道

| 通道 | 协议/库 | 多账号 | 群组 | 说明 |
|---|---|---|---|---|
| **WhatsApp** | Baileys | ✅ | ✅ | 多设备支持 |
| **Telegram** | grammY | ✅ | ✅ | Bot API |
| **Discord** | discord.js | ✅ | ✅ | 需 Message Content Intent |
| **iMessage** | BlueBubbles | ❌ | ✅ | macOS only |

### 3.2 插件通道

| 通道 | 插件包 |
|---|---|
| Mattermost | `@openclaw/plugin-mattermost` |
| Matrix | `@openclaw/plugin-matrix` |
| Slack | `@openclaw/plugin-slack` |
| Microsoft Teams | `@openclaw/plugin-msteams` |
| Nostr | `@openclaw/plugin-nostr` |
| Signal | `@openclaw/plugin-signal` |
| IRC | `@openclaw/plugin-irc` |
| Line | `@openclaw/plugin-line` |
| Google Chat | `@openclaw/plugin-googlechat` |
| Feishu (飞书) | `@openclaw/plugin-feishu` |
| QQ | `@openclaw/plugin-qqbot` |
| Zalo | `@openclaw/plugin-zalo` |

### 3.3 通道通用功能

```json5
// 群组路由
channels: {
  whatsapp: {
    groups: {
      "*": { requireMention: true },  // 所有群需要 @mention
      "group-id": { requireMention: false }  // 例外
    }
  }
}

// DM 策略
channels: {
  telegram: {
    dmPolicy: "pairing" | "allowlist" | "open"
  }
}
```

---

## 四、多 Agent 系统

### 4.1 核心概念

| 概念 | 说明 |
|---|---|
| `agentId` | 一个独立的大脑（workspace + auth + session store） |
| `accountId` | 一个通道账号实例（如两个 WhatsApp） |
| `binding` | 路由规则：`channel` + `accountId` + `peer` → `agentId` |

### 4.2 Agent 隔离

每个 Agent 有完全独立的所有资源：

```
agentId = "main"
├── workspace: ~/.openclaw/workspace
├── agentDir: ~/.openclaw/agents/main/agent
│   └── auth-profiles.json（独立认证）
└── sessions: ~/.openclaw/agents/main/sessions/

agentId = "work"
├── workspace: ~/.openclaw/workspace-work
├── agentDir: ~/.openclaw/agents/work/agent
└── sessions: ~/.openclaw/agents/work/sessions/
```

### 4.3 路由优先级（most-specific wins）

1. `peer` 精确匹配（DM / group id）
2. `parentPeer`（线程继承）
3. `guildId + roles`（Discord 角色路由）
4. `accountId` 匹配
5. channel 级别 fallback
6. 默认 agent

### 4.4 Workspace 文件

```
<workspace>/
├── SOUL.md       — 人格、语气、边界
├── AGENTS.md     — 多身份定义
├── IDENTITY.md   — 名字、emoji、头像
├── USER.md       — 用户信息
├── TOOLS.md      — 工具笔记（环境特化配置）
├── MEMORY.md     — 长期记忆
├── HEARTBEAT.md  — 心跳检查清单
├── BOOTSTRAP.md  — 首次运行引导（完成后删除）
└── memory/       — 每日笔记（YYYY-MM-DD.md）
```

### 4.5 路由示例

```json5
// WhatsApp 多号码路由
{
  bindings: [
    { agentId: "home", match: { channel: "whatsapp", accountId: "personal" } },
    { agentId: "work", match: { channel: "whatsapp", accountId: "biz" } },
  ]
}

// Discord 多 Bot 路由
{
  bindings: [
    { agentId: "main", match: { channel: "discord", accountId: "default" } },
    { agentId: "coding", match: { channel: "discord", accountId: "coding" } },
  ]
}

// 按群组路由
{
  bindings: [
    {
      agentId: "family",
      match: {
        channel: "whatsapp",
        peer: { kind: "group", id: "1203630...@g.us" }
      },
      agentConfig: {
        tools: { allow: ["read", "sessions_list", "sessions_history"] }
      }
    }
  ]
}
```

---

## 五、会话系统（Session）

### 5.1 会话路由行为

| 来源 | 行为 |
|---|---|
| DM | 共享 `main` session（同一个人连续对话） |
| 群组 | 独立 session |
| Cron | 每次全新 session |
| Webhook | 独立 session |

### 5.2 Session 存储

```
~/.openclaw/agents/<agentId>/sessions/
├── sessions.json      # 元数据
└── <sessionId>.jsonl  # 完整对话记录（JSONL）
```

### 5.3 队列模式（Queue Mode）

| 模式 | 行为 |
|---|---|
| `steer` | 消息注入当前 run（等待当前 turn 结束） |
| `followup` | 消息 held 直到当前 turn 结束 |
| `collect` | 消息 held 直到当前 turn 结束（可合并） |

### 5.4 Steering（steer 模式）

```
用户消息 → 等待当前 assistant turn 工具执行完毕
         → 注入下一个 LLM 调用边界
         → 不跳过当前已触发的工具调用
```

---

## 六、工具系统（Tools）

### 6.1 核心内置工具

| 工具 | 功能 |
|---|---|
| `read` | 读取文件（支持 glob 模式） |
| `write` | 写入文件 |
| `edit` | 编辑文件（unified diff） |
| `apply_patch` | 应用多 hunk 补丁 |
| `exec` | Shell 命令执行 |
| `process` | 后台进程管理 |
| `browser` | Chromium 浏览器控制 |
| `web_search` | Web 搜索（Brave/Perplexity/Gemini/Grok/Kimi/Firecrawl） |
| `web_fetch` | 页面内容抓取 |
| `image` | 图片分析 |
| `image_generate` | 图片生成/编辑 |
| `canvas` | Node Canvas 驱动（HTML/CSS/JS 演示） |
| `code_execution` | 沙箱化远程 Python |
| `nodes` | 发现和目标配对设备 |
| `cron` | 定时任务 |
| `sessions_list` | 列出会话 |
| `sessions_history` | 获取会话历史 |
| `sessions_send` | 发送消息到其他会话 |
| `sessions_spawn` | 启动 subagent |
| `session_status` | 会话状态/用量 |
| `agents_list` | 列出所有 agent |
| `memory_search` | 记忆搜索 |
| `memory_get` | 读取记忆文件 |
| `mcp_*` | MCP 工具 |
| `skill_*` | Skill 工具 |

### 6.2 工具策略

```json5
{
  agents: {
    list: [{
      id: "family",
      tools: {
        profile: "minimal",  // full / coding / messaging / minimal
        allow: ["exec", "read", "sessions_*"],
        deny: ["write", "edit", "browser", "nodes", "cron"]
      }
    }]
  }
}
```

### 6.3 沙箱配置

```json5
{
  agents: {
    list: [{
      id: "family",
      sandbox: {
        mode: "off" | "all",  // off=无沙箱, all=总是沙箱
        scope: "agent",       // agent / shared
        docker: {
          setupCommand: "apt-get update && apt-get install -y git curl"
        }
      }
    }]
  }
}
```

---

## 七、记忆系统（Memory）

### 7.1 记忆文件

```
MEMORY.md           — 长期记忆（持久事实、偏好）
memory/YYYY-MM-DD.md — 每日笔记
```

### 7.2 记忆类型

| 类型 | 说明 |
|---|---|
| `user` | 用户角色、偏好、职责 |
| `feedback` | 用户指导（纠正或确认） |
| `project` | 项目状态、目标、bugs |
| `reference` | 参考信息 |

### 7.3 记忆后端

| 后端 | 说明 |
|---|---|
| `memory-core`（默认） | SQLite，支持向量相似度 + 关键词混合搜索 |
| `memory-qmd` | 本地 sidecar + reranking + 查询扩展 |
| `memory-honcho` | AI-native 跨会话记忆 + 用户建模 |

### 7.4 记忆搜索

- **Hybrid 搜索**：向量相似度 + 关键词匹配
- **自动检测 provider**：OpenAI / Gemini / Voyage / Mistral API key 配置后自动启用
- **CLI**：
  ```bash
  openclaw memory status
  openclaw memory search "query"
  openclaw memory index --force
  ```

### 7.5 自动 Memory Flush

> compaction（压缩）发生前，自动运行 silent turn 提醒 agent 保存重要上下文到文件

---

## 八、压缩系统（Compaction）

### 8.1 自动压缩

当对话过长时，自动压缩会话历史：
- 保留关键信息
- 生成摘要
- 减少 token 消耗

### 8.2 压缩钩子

```javascript
before_compaction  // 压缩前
after_compaction   // 压缩后
```

---

## 九、技能系统（Skills）

### 9.1 加载位置（优先级递减）

```
<workspace>/skills              # 最高
<workspace>/.agents/skills
~/.agents/skills
~/.openclaw/skills（managed）
<openclaw>/skills（bundled）
skills.load.extraDirs           # 最低
```

### 9.2 SKILL.md 格式

```markdown
---
name: image-lab
description: Generate or edit images via a provider-backed image workflow
metadata:
  {
    "openclaw": {
      "requires": { "bins": ["uv"], "env": ["GEMINI_API_KEY"] },
      "primaryEnv": "GEMINI_API_KEY"
    }
  }
---

# 技能说明...

当用户想生成图片时使用此技能...
```

### 9.3 条件加载

```markdown
---
metadata: {
  "openclaw": {
    "requires": {
      "bins": ["gh"],           // 必须存在的二进制
      "anyBins": ["npm", "pnpm"], // 至少一个存在
      "env": ["OPENAI_API_KEY"], // 必须存在的环境变量
      "config": ["browser.enabled"] // 必须为真的配置
    }
  }
}
---
```

### 9.4 ClawHub

- 官网：https://clawhub.com
- `openclaw skills install <slug>` — 安装技能
- `openclaw skills update --all` — 更新所有技能
- `clawhub sync --all` — 发布更新

---

## 十、插件系统（Plugins）

### 10.1 架构

```
Plugin = channels + providers + tools + skills + hooks
```

### 10.2 插件注册能力

```json
{
  "channels": ["whatsapp", "telegram"],
  "providers": ["anthropic", "openai"],
  "tools": ["my_custom_tool"],
  "skills": ["./skills/my-skill"],
  "hooks": ["before_agent_start"]
}
```

### 10.3 内置插件

- `memory-core` — SQLite 向量记忆引擎
- `memory-lancedb` — LanceDB 记忆后端
- `anthropic` — Anthropic API provider
- `openai` — OpenAI API provider
- `browser` — 浏览器自动化
- `pi-embedded` — 内置 Pi agent 运行时

---

## 十一、Provider / Model

### 11.1 支持的 Provider（35+）

| Provider | 说明 |
|---|---|
| Anthropic | claude-3-5-sonnet / opus / haiku |
| OpenAI | GPT-4o / o1 / o3 |
| Google | Gemini / Vertex AI |
| AWS Bedrock | Claude via AWS |
| Azure Foundry | Microsoft 集成 |
| Ollama | 本地模型 |
| vLLM / SGLang | 自托管 |
| Grok (xAI) | |
| DeepSeek | |
| Moonshot (Kimi) | |
| Mistral | |
| Cohere | |
| 等等 | |

### 11.2 Model 配置

```json5
{
  agents: {
    defaults: {
      model: "anthropic/claude-sonnet-4-6"
    }
  }
}
```

### 11.3 Model Ref 格式

- `provider/model` 格式（如 `anthropic/claude-sonnet-4-6`）
- 如果 model ID 本身包含 `/`（OpenRouter 风格），需要加 provider 前缀

---

## 十二、Web Control UI

```
http://127.0.0.1:18789/
  - Chat 界面
  - 配置管理
  - Sessions 监控
  - Gateway 状态
  - Node 管理
```

---

## 十三、移动节点（Nodes）

### 13.1 iOS / Android 节点

- **配对**：设备级配对 + token 认证
- **Canvas**：远程屏幕控制
- **Camera**：拍照/录像
- **Screen recording**：屏幕录制
- **Location**：位置
- **Voice**：语音交互

### 13.2 macOS 节点

- 菜单栏伴侣 app
- 完整节点能力

### 13.3 Headless 节点

- 无头模式运行

---

## 十四、Streaming 与回复

### 14.1 Block Streaming（通道消息）

```
Model output → text_delta/events
              → chunker 缓冲
              → 达到阈值 → channel send
```

**控制**：
```json5
{
  agents: {
    defaults: {
      blockStreamingDefault: "on" | "off",
      blockStreamingBreak: "text_end" | "message_end",
      blockStreamingChunk: { minChars: 800, maxChars: 1200 }
    }
  }
}
```

### 14.2 Preview Streaming（Telegram/Discord/Slack）

| 模式 | 行为 |
|---|---|
| `off` | 禁用 |
| `partial` | 单预览消息，实时替换 |
| `block` | 分块/追加预览 |
| `progress` | 状态预览 + 最终答案 |

### 14.3 Human-like Pacing

```json5
{
  agents: {
    defaults: {
      humanDelay: "natural"  // off / natural(800-2500ms) / custom
    }
  }
}
```

---

## 十五、Hook 系统

### 15.1 完整 Hook 列表

| Hook | 时机 |
|---|---|
| `agent:bootstrap` | 构建 bootstrap 文件时 |
| `before_model_resolve` | 模型解析前（无 messages） |
| `before_prompt_build` | Prompt 构建前（有 messages） |
| `before_agent_start` | Agent 启动前 |
| `before_agent_reply` | Agent 回复前（可返回合成回复） |
| `agent_end` | Agent 结束时 |
| `before_compaction` | 压缩前 |
| `after_compaction` | 压缩后 |
| `before_tool_call` | 工具调用前（可 block） |
| `after_tool_call` | 工具调用后 |
| `before_install` | 安装前（可 block） |
| `tool_result_persist` | 工具结果持久化前 |
| `message_received` | 消息接收时 |
| `message_sending` | 消息发送时（可 cancel） |
| `message_sent` | 消息已发送 |
| `session_start` | 会话开始 |
| `session_end` | 会话结束 |
| `gateway_start` | Gateway 启动 |
| `gateway_stop` | Gateway 停止 |

### 15.2 Hook 决策规则

```javascript
// block 行为
before_tool_call: { block: true }  // 终止，不执行工具
before_tool_call: { block: false }  // 无操作，不清除之前的 block

// cancel 行为
message_sending: { cancel: true }  // 终止，不发送
message_sending: { cancel: false } // 无操作，不清除之前的 cancel
```

---

## 十六、认证与安全

### 16.1 认证方式

| 方式 | 说明 |
|---|---|
| API Key | 直接配置在 `openclaw.json` |
| OAuth | Provider OAuth 流程（如 OpenAI Codex） |
| Device Pairing | 设备级配对 + token |

### 16.2 安全控制

```json5
// DM 隔离
channels: {
  whatsapp: {
    allowFrom: ["+15551234567"],  // 允许列表
    dmPolicy: "pairing" | "allowlist" | "open"
  }
}

// Tool 限制
agents: {
  list: [{
    tools: {
      allow: ["exec", "read"],
      deny: ["write", "edit", "browser"]
    }
  }]
}
```

### 16.3 SSRF 防护

内置，防止工具请求内部网络。

---

## 十七、Exec Approvals

```json5
{
  tools: {
    exec: {
      approvals: {
        mode: "deny" | "ask" | "bypass",
        denyPatterns: ["rm -rf /", "curl.*|wget.*"],
        askPatterns: ["curl", "wget", "ssh"]
      }
    }
  }
}
```

| 模式 | 行为 |
|---|---|
| `deny` | 所有 exec 需审批 |
| `ask` | 匹配 `askPatterns` 的 exec 需审批 |
| `bypass` | 无需审批 |

---

## 十八、CLI 命令

```bash
# Gateway
openclaw gateway start
openclaw gateway stop
openclaw gateway restart
openclaw dashboard

# Agent
openclaw agents add <name>
openclaw agents list --bindings
openclaw agents remove <name>

# Channel
openclaw channels login --channel whatsapp --account personal
openclaw channels status --probe
openclaw channels logout --channel whatsapp --account personal

# Skills
openclaw skills install <slug>
openclaw skills update --all

# Memory
openclaw memory status
openclaw memory search "query"
openclaw memory index --force

# MCP
openclaw mcp list
openclaw mcp start <name>
openclaw mcp stop <name>

# 其他
openclaw doctor          # 诊断
openclaw onboard        # 引导设置
openclaw logs           # 查看日志
```

---

## 十九、配置参考

### 19.1 最小配置

```json5
{
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace"
    }
  },
  channels: {
    whatsapp: {
      allowFrom: ["+15551234567"]
    }
  }
}
```

### 19.2 完整配置结构

```json5
{
  agents: {
    defaults: {
      workspace: "~/workspaces/main",
      model: "anthropic/claude-sonnet-4-6",
      blockStreamingDefault: "off",
      humanDelay: "natural",
      memorySearch: {
        qmd: { extraCollections: [] }
      }
    },
    list: [
      {
        id: "main",
        workspace: "~/workspaces/main",
        model: "anthropic/claude-sonnet-4-6",
        sandbox: { mode: "off" },
        tools: { profile: "full" }
      },
      {
        id: "family",
        workspace: "~/workspaces/family",
        sandbox: { mode: "all", scope: "agent" },
        tools: {
          allow: ["read", "sessions_list", "sessions_history"],
          deny: ["write", "edit", "browser", "nodes", "cron"]
        }
      }
    ]
  },
  
  bindings: [
    { agentId: "main", match: { channel: "whatsapp", accountId: "personal" } },
    { agentId: "family", match: { channel: "whatsapp", peer: { kind: "group", id: "group-id" } } }
  ],
  
  channels: {
    whatsapp: {
      allowFrom: ["+15551234567"],
      groups: { "*": { requireMention: true } }
    },
    telegram: {
      accounts: {
        default: { botToken: "123:ABC..." },
        alerts: { botToken: "987:XYZ...", dmPolicy: "allowlist" }
      }
    }
  },
  
  skills: {
    entries: {
      "image-lab": { enabled: true, apiKey: "GEMINI_KEY" }
    }
  },
  
  memory: {
    backend: "core" | "qmd" | "honcho"
  }
}
```

---

## 二十、与 Claude Code 对比

| 维度 | OpenClaw | Claude Code |
|---|---|---|
| **架构** | 多通道 Gateway + 内置 Pi Agent | 单 CLI + Agent Harness |
| **通道** | 20+ 聊天平台 | 仅 CLI |
| **多 Agent** | 真正的多 Agent 隔离路由 | Subagent（主从 IPC） |
| **Identity/Soul** | `SOUL.md` / `AGENTS.md` / `IDENTITY.md` 文本化 | TypeScript 代码化 |
| **记忆** | 文本文件（MEMORY.md + QMD/Honcho） | API prompt cache + 压缩 |
| **工具** | 50+ plugins + 自定义 | 30+ 内置 |
| **MCP** | 支持（MCP SDK） | 支持（MCP SDK） |
| **部署** | 自托管（服务器/树莓派/手机） | 本地 CLI |
| **UI** | Web Control UI + 移动 App | CLI 为主 |
| **扩展** | 插件生态 + ClawHub | SDK + MCP |

---

## 二十一、核心设计哲学

1. **文本化记忆**：模型只在写文件时才"记住"，无隐藏状态
2. **自托管**：数据完全自控，不依赖云服务
3. **多通道统一**：一个 Gateway 连接所有聊天平台
4. **多 Agent 隔离**：每个 Agent 完全独立（workspace + auth + sessions）
5. **技能优先**：通过 Skills 扩展能力，而非修改核心代码
6. **渐进式复杂度**：默认开箱即用，高级配置按需开启