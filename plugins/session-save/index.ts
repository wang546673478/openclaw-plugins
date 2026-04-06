/**
 * Session Save Plugin
 *
 * Saves session summary to memory/sessions/ when session ends.
 * Captures: task description, key decisions, tool usage, errors.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginHookAgentEndEvent } from "openclaw/plugin-sdk/plugins/types.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface ToolCall {
  name: string;
  count: number;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }) {
  return {
    saveDir: (api.pluginConfig?.saveDir as string) || "memory/sessions",
    minDuration: (api.pluginConfig?.minDuration as number) || 30000,
  };
}

function extractSummary(messages: unknown[]): { task: string; decisions: string[]; tools: ToolCall[] } {
  const msgs = messages as Array<{ role?: string; content?: unknown; refusal?: unknown }>;
  const userMsgs = msgs.filter(m => m.role === "user");
  const assistantMsgs = msgs.filter(m => m.role === "assistant" && !m.refusal);

  // First user message as task
  const task = userMsgs[0]
    ? extractText(userMsgs[0].content).slice(0, 200)
    : "未知任务";

  // Collect tool calls from assistant messages via tool_call blocks
  const toolCounts = new Map<string, number>();
  for (const msg of assistantMsgs) {
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_call") {
          const tc = block as { name?: string };
          if (tc.name) {
            const name = tc.name.toLowerCase();
            toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
          }
        }
      }
    }
  }
  const tools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Extract key decisions from assistant messages
  const decisions: string[] = [];
  const DECISION_PATTERNS = [
    /(?:决定|decision|chosen|选择|采用了|确定用|用|建|写|改|删|修复|更新)\s*[：:]\s*(.{10,80})/gi,
    /(?:结论是|所以|因此|最终|最后)[:：]\s*(.{10,80})/gi,
    /(?:ok|okay|done|完成|好)[:：]?\s*(?:了\s*)?(.{5,50})/gi,
    /(?:will|going to|准备)[:：]\s*(.{10,60})/gi,
  ];

  for (const msg of assistantMsgs) {
    const text = extractText(msg.content);
    for (const pattern of DECISION_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const decision = match[1].trim();
        if (decision && decision.length > 5 && !decisions.includes(decision)) {
          decisions.push(decision.slice(0, 100));
        }
      }
    }
    // Also extract from tool results that indicate a decision was made
    if (text.includes("已创建") || text.includes("已更新") || text.includes("已删除") || text.includes("created") || text.includes("updated") || text.includes("deleted")) {
      const lines = text.split("\n").filter(l => l.trim().length > 0).slice(0, 3);
      for (const line of lines) {
        const trimmed = line.trim().slice(0, 100);
        if (trimmed.length > 10 && !decisions.includes(trimmed)) {
          decisions.push(trimmed);
        }
      }
    }
  }

  return { task, decisions: decisions.slice(0, 10), tools };
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
    return JSON.stringify(c);
  }
  return String(content);
}

export default definePluginEntry({
  id: "session-save",
  name: "Session Save",
  description: "Save session summary to memory/sessions/ on agent_end",
  register(api) {
    api.on("agent_end", async (
      event: PluginHookAgentEndEvent,
      ctx: { sessionKey?: string; sessionId?: string }
    ) => {
      const cfg = getConfig(api);

      if (event.durationMs && event.durationMs < cfg.minDuration) {
        api.logger.info(`session-save: session too short (${event.durationMs}ms < ${cfg.minDuration}ms), skipping`);
        return undefined;
      }

      const { task, decisions, tools } = extractSummary(event.messages);
      const now = new Date();
      const date = now.toISOString().split("T")[0];
      const time = now.toTimeString().slice(0, 8);
      const sessionId = ctx.sessionId || "unknown";

      const content = [
        `# Session ${date} ${time}`,
        "",
        `**Session ID**: ${sessionId}`,
        `**Duration**: ${event.durationMs ? Math.round(event.durationMs / 1000) + "s" : "unknown"}`,
        `**Success**: ${event.success ? "✅" : "❌"}`,
        event.error ? `**Error**: ${event.error}` : null,
        "",
        `## Task`,
        task,
        "",
        decisions.length > 0
          ? [`## Key Decisions`, ...decisions.map((d, i) => `${i + 1}. ${d}`)].join("\n")
          : null,
        "",
        `## Tools Used`,
        tools.length > 0
          ? tools.map(t => `- ${t.name}: ${t.count}x`).join("\n")
          : "_none_",
      ].filter(Boolean).join("\n");

      try {
        const dir = join(process.cwd(), cfg.saveDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const filename = `${date}-${sessionId.slice(0, 8)}.md`.replace(/[^a-z0-9\-_.]/gi, "_");
        const filepath = join(dir, filename);
        writeFileSync(filepath, content);
        api.logger.info(`session-save: saved to ${filepath}`);
      } catch (e) {
        api.logger.info(`session-save: failed to write: ${e}`);
      }

      return undefined;
    });

    api.on("gateway_start", async () => {
      api.logger.info("session-save plugin loaded");
      return undefined;
    });

    api.logger.info("session-save plugin registered hooks: agent_end");
  },
});
