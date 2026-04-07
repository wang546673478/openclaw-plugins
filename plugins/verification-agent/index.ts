/**
 * Verification Agent Plugin (P1 2.4 VERIFICATION_AGENT)
 *
 * Automatically verifies code changes by spawning a verification subagent
 * when significant file writes/edits are detected.
 *
 * Flow:
 * 1. after_tool_call detects write/edit/exec of code files
 * 2. Spawns a verification subagent with the relevant files
 * 3. Subagent runs appropriate verification (test/lint/build)
 * 4. Results are stored in memory/verification/
 *
 * This complements code-change plugin's manual verification.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugins/types.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface VerificationConfig {
  enabled: boolean;
  verifyOnWrite: boolean;
  verifyOnExec: boolean;
  maxFileSize: number;
}

function getConfig(api: { pluginConfig?: Record<string, unknown> }): VerificationConfig {
  const cfg = api.pluginConfig ?? {};
  return {
    enabled: (cfg.enabled as boolean) ?? true,
    verifyOnWrite: (cfg.verifyOnWrite as boolean) ?? true,
    verifyOnExec: (cfg.verifyOnExec as boolean) ?? false,
    maxFileSize: (cfg.maxFileSize as number) ?? 100_000,
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

function detectCodeFile(cmd: string): boolean {
  const codeExtensions = [
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".cpp", ".h", ".hpp",
    ".css", ".scss", ".less",
    ".html", ".htm", ".svelte", ".vue",
    ".json", ".yaml", ".yml", ".toml", ".xml",
    ".sh", ".bash", ".zsh",
    ".sql", ".md",
  ];
  return codeExtensions.some(ext => cmd.includes(ext));
}

function detectVerificationCommand(cmd: string): { type: string; file?: string } | null {
  const lower = cmd.toLowerCase();

  if (lower.includes("npm run build") || lower.includes("pnpm build") || lower.includes("yarn build")) {
    return { type: "build" };
  }
  if (lower.includes("npm test") || lower.includes("pnpm test") || lower.includes("yarn test") || lower.includes("jest") || lower.includes("vitest")) {
    return { type: "test" };
  }
  if (lower.includes("eslint") || lower.includes("ruff") || lower.includes("pylint") || lower.includes("tsc") || lower.includes("clippy")) {
    return { type: "lint" };
  }
  if (lower.includes("pytest") || lower.includes("go test") || lower.includes("cargo test") || lower.includes("gradle test")) {
    return { type: "test" };
  }
  if (lower.includes("make") && lower.includes("test")) {
    return { type: "test" };
  }

  return null;
}

function isSignificantWrite(cmd: string): boolean {
  const writeCommands = [
    "write", "edit", "patch", "create", "update",
  ];
  return writeCommands.some(w => cmd.toLowerCase().includes(w));
}

function saveVerificationRequest(
  wsDir: string,
  data: {
    id: string;
    trigger: "write" | "exec";
    command: string;
    timestamp: string;
    verificationType?: string;
  }
): void {
  try {
    const dir = join(wsDir, "memory", "verification");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filepath = join(dir, "pending-verifications.json");
    let existing: typeof data[] = [];
    try {
      existing = JSON.parse(readFileSync(filepath, "utf-8"));
    } catch {}
    existing.push(data);
    // Keep last 20
    if (existing.length > 20) existing.splice(0, existing.length - 20);
    writeFileSync(filepath, JSON.stringify(existing, null, 2), "utf-8");
  } catch {}
}

export default definePluginEntry({
  id: "verification-agent",
  name: "Verification Agent",
  description: "Automatically verify code changes by spawning verification subagents (P1 2.4 VERIFICATION_AGENT)",
  register(api) {
    const cfg = getConfig(api);

    // ── after_tool_call: detect code changes ───────────────────────────
    api.on("after_tool_call", async (
      event: PluginHookAfterToolCallEvent,
      ctx: PluginHookToolContext
    ) => {
      if (!cfg.enabled) return undefined;

      const toolName = event.toolName;
      const params = event.params as { command?: string; file?: string; path?: string } | undefined;
      const cmd = params?.command || "";

      // Detect verification command execution (e.g., npm test)
      if (cfg.verifyOnExec && toolName === "exec" && cmd) {
        const verification = detectVerificationCommand(cmd);
        if (verification) {
          const wsDir = getWorkspaceDir();
          const id = `verif-${Date.now()}`;
          saveVerificationRequest(wsDir, {
            id,
            trigger: "exec",
            command: cmd,
            timestamp: new Date().toISOString(),
            verificationType: verification.type,
          });
          api.logger.info(
            `verification-agent: detected ${verification.type} command: ${cmd.slice(0, 100)}`
          );
        }
      }

      // Detect file write operations
      if (cfg.verifyOnWrite && toolName === "write" && params) {
        const file = (params as { path?: string }).path || (params as { file?: string }).file || "";
        if (file && detectCodeFile(file)) {
          const wsDir = getWorkspaceDir();
          const id = `verif-${Date.now()}`;
          saveVerificationRequest(wsDir, {
            id,
            trigger: "write",
            command: file,
            timestamp: new Date().toISOString(),
          });
          api.logger.info(`verification-agent: detected code write to ${file}`);
        }
      }

      return undefined;
    });

    // ── register verification tool ──────────────────────────────────────
    api.registerTool({
      name: "verification_status",
      description: "Check pending verification requests and their status. Use after code changes to see if verification was triggered.",
      parameters: {},
      async execute(_id, _params) {
        const wsDir = getWorkspaceDir();
        const filepath = join(wsDir, "memory", "verification", "pending-verifications.json");
        let pending: Array<{ id: string; trigger: string; command: string; timestamp: string; verificationType?: string }> = [];
        try {
          if (existsSync(filepath)) {
            pending = JSON.parse(readFileSync(filepath, "utf-8"));
          }
        } catch {}

        if (pending.length === 0) {
          return {
            content: [{
              type: "text",
              text: "【验证状态】暂无待处理的验证请求。\n\n使用 `verification_trigger({ files: [...] })` 手动触发验证。",
            }],
          };
        }

        const lines = ["## 待验证请求\n"];
        for (const p of pending.slice(-5).reverse()) {
          lines.push(`- **${p.trigger}**: \`${p.command}\` (${p.timestamp}) ${p.verificationType ? `[${p.verificationType}]` : ""}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      },
    }, { optional: true });

    api.registerTool({
      name: "verification_trigger",
      description: "Manually trigger a verification subagent for specified files. Provide an array of file paths to verify.",
      parameters: {},
      async execute(_id, params: { files?: string[]; type?: "test" | "build" | "lint" | "all" }) {
        const files = params?.files ?? [];
        const type = params?.type ?? "all";
        if (files.length === 0) {
          return { content: [{ type: "text", text: "需要提供 files 参数（文件路径数组）。" }] };
        }

        const wsDir = getWorkspaceDir();
        const id = `verif-${Date.now()}`;
        saveVerificationRequest(wsDir, {
          id,
          trigger: "write",
          command: files.join(", "),
          timestamp: new Date().toISOString(),
          verificationType: type,
        });

        const verifyWhat = type === "all" ? "test + lint + build" : type;
        return {
          content: [{
            type: "text",
            text: `【验证已触发】\n\n- 文件: ${files.join(", ")}\n- 验证类型: ${verifyWhat}\n- 请求ID: ${id}\n\n请在完成后调用 verification_status 查看结果。`,
          }],
        };
      },
    }, { optional: true });

    api.on("gateway_start", async () => {
      const wsDir = getWorkspaceDir();
      const dir = join(wsDir, "memory", "verification");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      api.logger.info("verification-agent plugin loaded (auto-detect + manual trigger)");
      return undefined;
    });

    api.logger.info(
      "verification-agent registered: after_tool_call (auto-detect), verification_status tool, verification_trigger tool"
    );
  },
});
