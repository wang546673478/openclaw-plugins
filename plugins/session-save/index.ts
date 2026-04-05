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
  const msgs = messages as Array<{ role?: string; content?: unknown }>;
  const userMsgs = msgs.filter(m => m.role === "user");
  const assistantMsgs = msgs.filter(m => m.role === "assistant");

  // First user message as task
  const task = userMsgs[0]
    ? extractText(userMsgs[0].content).slice(0, 200)
    : "未知任务";

  // Collect tool calls from assistant messages
  const toolCounts = new Map<string, number>();
  for (const msg of assistantMsgs) {
    const text = extractText(msg.content);
    const matches = text.matchAll(/tools?\.(?:read|write|exec|edit|search|image|web_search)/gi);
    for (const m of matches) {
      const tool = m[0].toLowerCase();
      toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
    }
  }
  const tools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { task, decisions: [], tools };
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

      const { task, tools } = extractSummary(event.messages);
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
        `**Error**: ${event.error || "none"}`,
        "",
        `## Task`,
        task,
        "",
        `## Tools Used`,
        tools.length > 0
          ? tools.map(t => `- ${t.name}: ${t.count}x`).join("\n")
          : "_none_",
      ].join("\n");

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
