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
const TEST_COMMANDS = ["test", "jest", "pytest", "npm", "pnpm", "yarn", "bun", "ruby", "python", "go", "cargo", "gradle", "make"];
const LINT_COMMANDS = ["eslint", "ruff", "clippy", "golangci-lint", "hadolint", "shellcheck", "prettier", "rubocop", "pylint", "flake8", "tsc", "golangci-lint"];
let lastGitStatus = "";
let pendingVerification: { type: "commit" | "push"; cmd: string; timestamp: number } | null = null;

function isGitCommand(cmd: string): boolean {
  const parts = cmd.trim().split(/\s+/);
  const base = parts[0].toLowerCase();
  return GIT_COMMANDS.some(g => base.endsWith(g) || base === g);
}

function getLogFile(wsDir: string): string {
  return join(wsDir, "memory", "code-changes.md");
}

function logChange(entry: string, wsDir: string) {
  try {
    const dir = join(wsDir, "memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(getLogFile(wsDir), entry);
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

      // Resolve workspace dir from ctx or fallback
      const home = process.env.HOME || "/home/hhhh";
      const wsDir = (ctx as { workspaceDir?: string }).workspaceDir ||
        [join(home, ".openclaw", "workspace"), join(home, ".openclaw"), process.cwd()].find(p => existsSync(p)) || process.cwd();

      // Detect significant changes
      if (cmd.includes("git status") && resultText) {
        const changed = resultText.split("\n").filter(l => l.startsWith("modified:") || l.startsWith("new file:")).length;
        if (changed > 0) {
          const entry = `\n## ${now}\n\n**Command**: \`${cmd}\`\n\n${resultText.slice(0, 500)}\n`;
          logChange(entry, wsDir);
          api.logger.info(`code-change: detected ${changed} file changes`);
        }
        lastGitStatus = resultText;
      }

      if (cmd.includes("git diff") && resultText && resultText.length > 50) {
        const entry = `\n## ${now}\n\n**Command**: \`${cmd}\`\n\n\`\`\`diff\n${resultText.slice(0, 1000)}\n\`\`\`\n`;
        logChange(entry, wsDir);
        api.logger.info(`code-change: logged git diff (${resultText.length} chars)`);
      }

      if ((cmd.includes("git commit") || cmd.includes("git push")) && resultText) {
        pendingVerification = { type: cmd.includes("commit") ? "commit" : "push", cmd, timestamp: Date.now() };
        const entry = `\n## ${now}\n\n**Command**: \`${cmd}\`\n\n${resultText.slice(0, 300)}\n\n_等待验证结果..._\n`;
        logChange(entry, wsDir);
        api.logger.info(`code-change: logged commit/push, awaiting verification`);
      }

      // Check if this is a test/lint command that can verify a pending commit
      if (pendingVerification && Date.now() - pendingVerification.timestamp < 120000) {
        const isTestCmd = TEST_COMMANDS.some(t => cmd.includes(t)) || cmd.includes("test") || cmd.includes("lint") || cmd.includes("check");
        const isVerification = LINT_COMMANDS.some(l => cmd.includes(l)) || cmd.includes("test") || cmd.includes("spec");
        if (isTestCmd || isVerification) {
          const passed = resultText && !resultText.includes("FAIL") && !resultText.includes("ERROR") && !resultText.includes("failed") && !resultText.includes("error") && !resultText.includes("0 passed");
          const verdict = passed ? "✅ 测试通过" : "⚠️ 测试可能失败";
          const entry = `\n## ${now} — 验证结果\n\n**验证类型**: ${pendingVerification.type}\n**命令**: \`${pendingVerification.cmd}\`\n**测试命令**: \`${cmd}\`\n**结果**: ${verdict}\n\n${resultText ? resultText.slice(0, 500) : "(无输出)"}\n`;
          logChange(entry, wsDir);
          api.logger.info(`code-change: verification complete — ${verdict}`);
          pendingVerification = null;
        }
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
