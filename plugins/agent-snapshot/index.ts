/**
 * Agent Snapshot Plugin (P1 2.3)
 *
 * Writes subagent session snapshots to memory/snapshots/ on subagent_end.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginHookSubagentEndedEvent } from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

interface SnapshotConfig {
  snapshotDir: string;
  minDuration: number;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): SnapshotConfig {
  return {
    snapshotDir: (api.pluginConfig?.snapshotDir as string) || "memory/snapshots",
    minDuration: (api.pluginConfig?.minDuration as number) || 30000,
  };
}

function getWorkspaceDir(): string {
  const home = process.env.HOME || "/home/hhhh";
  const candidates = [
    join(home, ".openclaw", "workspace"),
    join(home, ".openclaw"),
    process.cwd(),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

function extractText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(c => extractText(c)).join(" ");
  }
  if (typeof content === "object" && content !== null) {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
    if (typeof c.content === "string") return c.content;
  }
  return "";
}

interface SessionMessage {
  type: string;
  role?: string;
  content?: unknown;
  refusal?: unknown;
}

function parseSessionJsonl(content: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  const lines = content.split("\n").filter(l => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "message" && obj.message) {
        messages.push(obj.message as SessionMessage);
      }
    } catch {}
  }
  return messages;
}

function sessionKeyToPath(sessionKey: string): string | null {
  const parts = sessionKey.split(":");
  if (parts.length < 2) return null;
  const agentId = parts[1];
  const sessionId = parts[parts.length - 1];
  const home = process.env.HOME || "/home/hhhh";
  return join(home, ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`);
}

function generateSnapshot(
  messages: SessionMessage[],
  sessionKey: string,
  outcome: string,
  error?: string
): string {
  const userMsgs = messages.filter(m => m.role === "user");
  const assistantMsgs = messages.filter(m => m.role === "assistant" && !m.refusal);

  const task = userMsgs.length > 0
    ? extractText(userMsgs[0].content).slice(0, 200)
    : "(无任务描述)";

  const lastAssistant = assistantMsgs.length > 0
    ? extractText(assistantMsgs[assistantMsgs.length - 1].content).slice(0, 300)
    : "(无输出)";

  const toolCalls = assistantMsgs.filter(m => {
    const content = m.content;
    if (Array.isArray(content)) {
      return content.some((b: unknown) => typeof b === "object" && (b as Record<string, unknown>)?.type === "tool_call");
    }
    return false;
  }).length;

  const recentAssistant = assistantMsgs.slice(-3);
  const decisions: string[] = [];
  for (const msg of recentAssistant) {
    const text = extractText(msg.content);
    if (text.includes("已创建") || text.includes("已更新") || text.includes("已完成") ||
        text.includes("created") || text.includes("updated") || text.includes("done")) {
      const lines = text.split("\n").filter(l => l.trim()).slice(0, 2);
      for (const line of lines) {
        const trimmed = line.trim().slice(0, 100);
        if (trimmed.length > 5) decisions.push(trimmed);
      }
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().slice(0, 8);

  const outcomeIcon = outcome === "ok" ? "✅" : outcome === "error" ? "❌" : "⏳";

  const sections = [
    `# Snapshot — ${dateStr} ${timeStr}`,
    "",
    `**Session**: ${sessionKey}`,
    `**Outcome**: ${outcomeIcon} ${outcome}`,
    error ? `**Error**: ${error}` : null,
    "",
    `## Task`,
    task,
    "",
    `## Last Output`,
    lastAssistant,
    "",
    `## Tool Calls`,
    toolCalls > 0 ? `${toolCalls} 次工具调用` : "_无_",
  ];

  if (decisions.length > 0) {
    sections.push("", `## Key Decisions`);
    decisions.slice(0, 5).forEach((d, i) => {
      sections.push(`${i + 1}. ${d}`);
    });
  }

  if (error) {
    sections.push("", `## Error Detail`);
    sections.push(error);
  }

  return sections.filter(Boolean).join("\n");
}

function writeSnapshot(content: string, sessionKey: string, wsDir: string, cfg: SnapshotConfig): void {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const sessionId = sessionKey.split(":").pop() || "unknown";
    const filename = `${dateStr}-${timeStr}-${sessionId.slice(0, 8)}.md`;

    const dir = join(wsDir, cfg.snapshotDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filepath = join(dir, filename);
    writeFileSync(filepath, content, "utf-8");

    const indexPath = join(dir, "index.md");
    const indexEntry = `| ${timeStr} | ${sessionKey.split(":").pop()?.slice(0, 12)} | ${filename} |\n`;
    if (existsSync(indexPath)) {
      const existing = readFileSync(indexPath, "utf-8");
      writeFileSync(indexPath, existing + indexEntry, "utf-8");
    } else {
      writeFileSync(indexPath, `# Snapshot Index\n\n| Time | Session | File |\n|------|---------|------|\n${indexEntry}`, "utf-8");
    }
  } catch {}
}

export default definePluginEntry({
  id: "agent-snapshot",
  name: "Agent Snapshot",
  description: "Write subagent session snapshots to memory/snapshots/ on subagent_ended",
  register(api) {
    const cfg = getConfig(api);

    api.on("subagent_ended", async (
      event: PluginHookSubagentEndedEvent
    ) => {
      try {
        const sessionKey = event.targetSessionKey;
        const outcome = event.outcome || "unknown";
        const error = event.error;

        let messages: SessionMessage[] = [];
        const sessionPath = sessionKeyToPath(sessionKey);

        if (sessionPath && existsSync(sessionPath)) {
          try {
            const stat = statSync(sessionPath);
            if (stat.size > 0 && stat.size < 10 * 1024 * 1024) {
              const content = readFileSync(sessionPath, "utf-8");
              messages = parseSessionJsonl(content);
            }
          } catch {}
        }

        const snapshot = generateSnapshot(messages, sessionKey, outcome, error);
        const wsDir = getWorkspaceDir();
        writeSnapshot(snapshot, sessionKey, wsDir, cfg);

        api.logger.info(`agent-snapshot: wrote snapshot for ${sessionKey} (outcome=${outcome}, messages=${messages.length})`);
      } catch (e) {
        api.logger.info(`agent-snapshot: error — ${e}`);
      }

      return undefined;
    });

    api.logger.info("agent-snapshot plugin registered hooks: subagent_ended");
  },
});
