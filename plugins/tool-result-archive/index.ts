/**
 * Tool Result Archive Plugin
 * Hooks: tool_result_persist
 * Archives tool outputs to memory/tool-archive/YYYY-MM-DD.md for memory_search retrieval.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookToolResultPersistEvent,
  PluginHookToolResultPersistContext,
} from "openclaw/plugin-sdk/plugins/types.js";

const ALWAYS = new Set(["web_fetch", "image", "memory_search", "video_frames"]);
const MAYBE = new Set(["read", "exec", "memory_get"]);

function archiveDir() {
  const home = process.env.HOME || "/home/hhhh";
  const ws = process.env.OPENCLAW_WORKSPACE || join(home, ".openclaw", "workspace");
  const d = join(ws, "memory", "tool-archive");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function text(msg: PluginHookToolResultPersistEvent["message"]): string {
  try {
    const c = msg?.content;
    if (!c) return "";
    if (typeof c === "string") return c.slice(0, 2000);
    if (Array.isArray(c)) return c.filter((b) => b.type === "text").map((b) => (b as { text: string }).text || "").join("\n");
  } catch {}
  return "";
}

function ok(msg: PluginHookToolResultPersistEvent["message"]): boolean {
  if (!msg) return false;
  const t = text(msg);
  return ALWAYS.has("") || (MAYBE.has("") && t.length > 50);
}

export default definePluginEntry({
  id: "tool-result-archive",
  name: "Tool Result Archive",
  description: "Archives tool outputs to memory/tool-archive/ for memory_search retrieval",
  register(api) {
    const maxLen = ((api.pluginConfig?.maxOutputLen as number) || 800);

    api.on("tool_result_persist", async (event: PluginHookToolResultPersistEvent, ctx: PluginHookToolResultPersistContext) => {
      const tool = event.toolName || "";
      if (!ok(event.message)) return undefined;

      const out = text(event.message).slice(0, maxLen);
      const sk = ctx.sessionKey || "default";
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = now.toISOString().slice(11, 19);

      const entry = `## [${time}] ${tool} | ${sk}\n${event.toolCallId ? `**id:** ${event.toolCallId}\n` : ""}\n**Out:**\n\`\`\`\n${out}\n\`\`\`\n\n`;
      try { appendFileSync(join(archiveDir(), `${date}.md`), entry, "utf-8"); } catch {}
      return undefined;
    });

    api.on("gateway_start", async () => {
      archiveDir();
      api.logger.info("tool-result-archive loaded");
      return undefined;
    });

    api.logger.info("tool-result-archive registered: tool_result_persist, gateway_start");
  },
});
