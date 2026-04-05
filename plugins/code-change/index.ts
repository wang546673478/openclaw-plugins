/**
 * Code Change Detection Plugin
 *
 * Monitors exec tool calls for git operations.
 * Detects: git diff, git status, git log, file modifications.
 * Logs changes to memory/code-changes.md for tracking.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugins/types.js";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const GIT_COMMANDS = ["git", "diff", "status", "log", "add", "commit", "push", "pull", "stash"];
let lastGitStatus = "";

function isGitCommand(cmd: string): boolean {
  const parts = cmd.trim().split(/\s+/);
  const base = parts[0].toLowerCase();
  return GIT_COMMANDS.some(g => base.endsWith(g) || base === g);
}

function getLogFile(): string {
  return join(process.cwd(), "memory/code-changes.md");
}

function logChange(entry: string) {
  try {
    const dir = join(process.cwd(), "memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(getLogFile(), entry);
  } catch {}
}

export default definePluginEntry({
  id: "code-change",
  name: "Code Change Detection",
  description: "Detect code changes via git operations in exec tool",
  register(api) {
    // after_tool_call — check git results
    api.on("after_tool_call", async (
      event: PluginHookAfterToolCallEvent,
      ctx: PluginHookToolContext
    ) => {
      if (event.toolName !== "exec") return undefined;

      const params = event.params as { command?: string; cmd?: string };
      const cmd = (params.command || params.cmd || "") as string;

      if (!isGitCommand(cmd)) return undefined;

      const result = event.result;
      const resultText = extractResultText(result);
      const now = new Date().toISOString();

      // Detect significant changes
      if (cmd.includes("git status") && resultText) {
        const changed = resultText.split("\n").filter(l => l.startsWith("modified:") || l.startsWith("new file:")).length;
        if (changed > 0) {
          const entry = `\n## ${now}\n\n**Command**: \`${cmd}\`\n\n${resultText.slice(0, 500)}\n`;
          logChange(entry);
          api.logger.info(`code-change: detected ${changed} file changes`);
        }
        lastGitStatus = resultText;
      }

      if (cmd.includes("git diff") && resultText && resultText.length > 50) {
        const entry = `\n## ${now}\n\n**Command**: \`${cmd}\`\n\n\`\`\`diff\n${resultText.slice(0, 1000)}\n\`\`\`\n`;
        logChange(entry);
        api.logger.info(`code-change: logged git diff (${resultText.length} chars)`);
      }

      if ((cmd.includes("git commit") || cmd.includes("git push")) && resultText) {
        const entry = `\n## ${now}\n\n**Command**: \`${cmd}\`\n\n${resultText.slice(0, 300)}\n`;
        logChange(entry);
        api.logger.info(`code-change: logged commit/push`);
      }

      return undefined;
    });

    api.on("gateway_start", async () => {
      api.logger.info("code-change plugin loaded");
      return undefined;
    });

    api.logger.info("code-change plugin registered hooks: after_tool_call");
  },
});

function extractResultText(result: unknown): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result.map(r => extractResultText(r)).join("\n");
  }
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.content)) {
      return (r.content as Array<{ type?: string; text?: string }>)
        .filter(c => c.type === "text")
        .map(c => c.text || "")
        .join("\n");
    }
    if (typeof r.text === "string") return r.text;
    if (typeof r.content === "string") return r.content;
  }
  return "";
}
