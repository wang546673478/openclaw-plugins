/**
 * Diagnostic Tracking Plugin (P2)
 *
 * Tracks:
 * - Tool error rates and types
 * - Tool latency distribution
 * - Session duration and message counts
 * - Compaction events (before/after)
 * - Token usage estimates
 *
 * Outputs to memory/diagnostics/YYYY-MM-DD.md
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookAgentEndEvent,
  PluginHookBeforeCompactionEvent,
  PluginHookAfterCompactionEvent,
  PluginHookSessionEndEvent,
} from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface DiagConfig {
  diagnosticDir: string;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): DiagConfig {
  return {
    diagnosticDir: (api.pluginConfig?.diagnosticDir as string) || "memory/diagnostics",
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

interface ToolStats {
  count: number;
  errors: number;
  totalDuration: number;
  lastUsed: string;
}

interface SessionStats {
  startTime: string;
  duration: number;
  messageCount: number;
  toolCalls: number;
  toolErrors: number;
}

interface CompactStats {
  count: number;
  tokenBefore: number;
  tokenAfter: number;
  compactedMessages: number;
}

interface DiagnosticState {
  tools: Record<string, ToolStats>;
  sessions: Record<string, SessionStats>;
  compactions: CompactStats[];
  sessionStartTime: Record<string, number>;
}

const state: DiagnosticState = {
  tools: {},
  sessions: {},
  compactions: [],
  sessionStartTime: {},
};

function getToolStats(name: string): ToolStats {
  if (!state.tools[name]) {
    state.tools[name] = { count: 0, errors: 0, totalDuration: 0, lastUsed: "" };
  }
  return state.tools[name];
}

function saveDiagReport(wsDir: string, cfg: DiagConfig): void {
  try {
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const dir = join(wsDir, cfg.diagnosticDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const lines: string[] = [
      `# Diagnostic Report — ${date}`,
      "",
      `Generated: ${now.toISOString()}`,
      "",
      `## Tool Statistics (all time)`,
      "",
      `| Tool | Count | Errors | Avg Duration | Last Used |`,
      `|------|-------|--------|-------------|-----------|`,
    ];

    const sortedTools = Object.entries(state.tools).sort((a, b) => b[1].count - a[1].count);
    for (const [name, stats] of sortedTools) {
      const avgDur = stats.count > 0 ? Math.round(stats.totalDuration / stats.count) : 0;
      const errorRate = stats.count > 0 ? ((stats.errors / stats.count) * 100).toFixed(1) : "0";
      lines.push(`| \`${name}\` | ${stats.count} | ${stats.errors} (${errorRate}%) | ${avgDur}ms | ${stats.lastUsed} |`);
    }

    lines.push("", `## Compaction Events (all time)`, "");
    if (state.compactions.length > 0) {
      for (const c of state.compactions) {
        lines.push(`- ${c.count}x compaction: ${c.compactedMessages} msgs, ${c.tokenBefore} → ${c.tokenAfter} tokens`);
      }
    } else {
      lines.push("_none_");
    }

    const content = lines.join("\n") + "\n";
    const filepath = join(dir, `${date}.md`);
    writeFileSync(filepath, content, "utf-8");
  } catch {}
}

export default definePluginEntry({
  id: "diagnostic-tracking",
  name: "Diagnostic Tracking",
  description: "Track tool errors, latency, token usage, and compaction events",
  register(api) {
    const cfg = getConfig(api);

    // ── after_tool_call: track tool stats ───────────────────────────────
    api.on("after_tool_call", async (
      event: PluginHookAfterToolCallEvent,
      ctx: { sessionKey?: string }
    ) => {
      const name = event.toolName;
      const stats = getToolStats(name);
      stats.count++;
      stats.totalDuration += event.durationMs || 0;
      stats.lastUsed = new Date().toISOString();
      if (event.error) {
        stats.errors++;
      }
      api.logger.debug(`diagnostic: tool=${name} errors=${stats.errors} duration=${event.durationMs}ms`);
      return undefined;
    });

    // ── session_start: track session start time ──────────────────────
    api.on("session_start", async (
      _event: unknown,
      ctx: { sessionKey?: string }
    ) => {
      const sk = ctx.sessionKey || "unknown";
      state.sessionStartTime[sk] = Date.now();
      api.logger.debug(`diagnostic: session start ${sk}`);
      return undefined;
    });

    // ── before_compaction: log before state ───────────────────────────
    api.on("before_compaction", async (
      event: PluginHookBeforeCompactionEvent,
      ctx: { sessionKey?: string }
    ) => {
      api.logger.info(`diagnostic: before_compaction session=${ctx.sessionKey} messages=${event.messageCount} tokens=${event.tokenCount}`);
      return undefined;
    });

    // ── after_compaction: track compaction ─────────────────────────────
    api.on("after_compaction", async (
      event: PluginHookAfterCompactionEvent,
      ctx: { sessionKey?: string }
    ) => {
      state.compactions.push({
        count: 1,
        tokenBefore: event.tokenCount + (event.compactedCount * 200), // estimate
        tokenAfter: event.tokenCount,
        compactedMessages: event.compactedCount,
      });
      api.logger.info(`diagnostic: after_compaction session=${ctx.sessionKey} compacted=${event.compactedCount} remaining=${event.messageCount}`);
      return undefined;
    });

    // ── agent_end: save session stats ─────────────────────────────────
    api.on("agent_end", async (
      event: PluginHookAgentEndEvent,
      ctx: { sessionKey?: string }
    ) => {
      const sk = ctx.sessionKey || "unknown";
      const startTime = state.sessionStartTime[sk];
      const duration = startTime ? Date.now() - startTime : 0;

      state.sessions[sk] = {
        startTime: new Date(startTime || Date.now()).toISOString(),
        duration,
        messageCount: event.messageCount || 0,
        toolCalls: Object.values(state.tools).reduce((sum, s) => sum + s.count, 0),
        toolErrors: Object.values(state.tools).reduce((sum, s) => sum + s.errors, 0),
      };

      // Save diagnostic report
      const wsDir = getWorkspaceDir();
      saveDiagReport(wsDir, cfg);

      api.logger.info(`diagnostic: agent_end session=${sk} duration=${duration}ms messages=${event.messageCount}`);
      return undefined;
    });

    // ── gateway_start: periodic report ─────────────────────────────────
    // Save report every hour (via heartbeat in a full implementation)
    api.on("gateway_start", async () => {
      try {
        const wsDir = getWorkspaceDir();
        const dir = join(wsDir, cfg.diagnosticDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const now = new Date();
        const date = now.toISOString().split("T")[0];
        const filepath = join(dir, `${date}.md`);
        if (!existsSync(filepath)) {
          writeFileSync(filepath, `# Diagnostic Report — ${date}\n\n_No data yet._\n`, "utf-8");
        }
      } catch {}
      api.logger.info("diagnostic-tracking plugin loaded");
      return undefined;
    });

    api.logger.info("diagnostic-tracking registered: after_tool_call, session_start, before_compaction, after_compaction, agent_end");
  },
});
