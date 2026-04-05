/**
 * Analytics Plugin
 *
 * Tracks:
 * - Tool usage counts and durations
 * - Session stats (messages, duration)
 * - Long session summaries to memory/analytics.md
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookAgentEndEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface ToolStats {
  name: string;
  count: number;
  totalDuration: number;
  errors: number;
}

interface SessionStats {
  toolCalls: number;
  totalDuration: number;
  messages: number;
  errors: number;
  startTime: number;
}

const sessionData = new Map<string, SessionStats>();
const toolStats = new Map<string, ToolStats>();

function getAnalyticsFile(api: { pluginConfig: Record<string, unknown> }): string {
  const configured = api.pluginConfig?.analyticsFile as string | undefined;
  return configured || "memory/analytics.md";
}

function writeAnalyticsEntry(api: { pluginConfig: Record<string, unknown>; logger: { info: (msg: string) => void } }, stats: SessionStats) {
  const filepath = getAnalyticsFile(api);
  const now = new Date().toISOString();
  const date = now.split("T")[0];

  let content = `\n## Session ${now}\n\n`;
  content += `- **Duration**: ${Math.round(stats.durationMs / 1000)}s\n`;
  content += `- **Tool Calls**: ${stats.toolCalls}\n`;
  content += `- **Messages**: ${stats.messages}\n`;
  content += `- **Errors**: ${stats.errors}\n`;

  // Top tools
  const sortedTools = [...toolStats.values()].sort((a, b) => b.count - a.count);
  if (sortedTools.length > 0) {
    content += `\n**Top Tools**:\n`;
    for (const tool of sortedTools.slice(0, 5)) {
      const avg = Math.round(tool.totalDuration / tool.count);
      content += `- ${tool.name}: ${tool.count}x (avg ${avg}ms)\n`;
    }
  }

  // Write to file
  try {
    const dir = join(process.cwd(), "memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filePath = join(process.cwd(), filepath);
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, "utf-8");
      content = existing + content;
    }
    writeFileSync(filePath, content);
    api.logger.info(`Analytics: wrote session summary (${stats.toolCalls} tool calls, ${Math.round(stats.durationMs / 1000)}s)`);
  } catch (e) {
    api.logger.info(`Analytics: failed to write file: ${e}`);
  }
}

export default definePluginEntry({
  id: "analytics",
  name: "Analytics",
  description: "Track tool usage and session stats to memory/analytics.md",
  register(api) {
    // after_tool_call — track each tool
    api.on("after_tool_call", async (
      event: PluginHookAfterToolCallEvent,
      ctx: PluginHookToolContext
    ) => {
      const sessionId = ctx.sessionId || "unknown";
      const now = Date.now();

      // Init session if needed
      if (!sessionData.has(sessionId)) {
        sessionData.set(sessionId, {
          toolCalls: 0,
          totalDuration: 0,
          messages: 0,
          errors: 0,
          startTime: now,
        });
      }

      const sess = sessionData.get(sessionId)!;
      sess.toolCalls++;
      sess.totalDuration += event.durationMs || 0;
      if (event.error) sess.errors++;

      // Tool-level stats
      const toolName = event.toolName;
      if (!toolStats.has(toolName)) {
        toolStats.set(toolName, { name: toolName, count: 0, totalDuration: 0, errors: 0 });
      }
      const t = toolStats.get(toolName)!;
      t.count++;
      t.totalDuration += event.durationMs || 0;
      if (event.error) t.errors++;

      return undefined;
    });

    // agent_end — write session summary
    api.on("agent_end", async (
      event: PluginHookAgentEndEvent,
      ctx: { sessionKey?: string; sessionId?: string }
    ) => {
      const sessionId = ctx.sessionId || "unknown";
      const sess = sessionData.get(sessionId);

      if (sess) {
        sess.durationMs = event.durationMs;
        const messages = event.messages as Array<{ role?: string }>;
        sess.messages = messages.length;
        writeAnalyticsEntry(api, sess);
        sessionData.delete(sessionId);
      }

      return undefined;
    });

    // gateway_start — reset in-memory stats
    api.on("gateway_start", async () => {
      toolStats.clear();
      sessionData.clear();
      api.logger.info("Analytics plugin loaded");
      return undefined;
    });

    api.logger.info("analytics plugin registered hooks: after_tool_call, agent_end");
  },
});
