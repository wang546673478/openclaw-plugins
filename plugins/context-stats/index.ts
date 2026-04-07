/**
 * Context Stats Plugin
 *
 * Tracks message counts, token estimates, and tool call stats
 * across the agent lifecycle. Writes snapshots to memory/stats/.
 *
 * Hooks used:
 * - session_start / session_end
 * - before_prompt_build
 * - after_tool_call
 * - agent_end
 * - before_compaction / after_compaction
 * - subagent_spawning / subagent_ended
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface SessionStats {
  sessionId: string;
  sessionKey: string;
  startedAt: string;
  endedAt?: string;
  messageCount: number;
  toolCallCount: number;
  toolErrors: number;
  subagentSpawns: number;
  subagentEnds: number;
  prePromptsInjected: number;
  lastTokenCount: number;
  lastMessageCount: number;
  compactionEvents: number;
  events: Array<{ ts: string; type: string; detail: string }>;
}

const sessions = new Map<string, SessionStats>();

// Token estimation: ~4 chars per token for English, ~2 for CJK
function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = text.length - cjk * 2;
  return Math.ceil((rest + cjk * 2) / 4);
}

function countMessageTokens(messages: unknown[]): number {
  let total = 0;
  for (const m of messages as Array<{ content?: unknown }>) {
    if (typeof m.content === "string") {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const block of m.content as Array<{ type?: string; text?: string }>) {
        if (block.type === "text" && block.text) {
          total += estimateTokens(block.text);
        }
      }
    }
  }
  return total;
}

function getStatsDir(api: { getConfig: () => Record<string, unknown> }): string {
  const cfg = api.getConfig();
  const base = process.env.OPENCLAW_WORKSPACE_DIR || process.cwd();
  const dir = (cfg.statsDir as string) || "memory/stats";
  return join(base, dir);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeSnapshot(sessionKey: string, stats: SessionStats): void {
  try {
    const dir = getStatsDir({ getConfig: () => ({}) });
    ensureDir(dir);
    const file = join(dir, `${sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    writeFileSync(file, JSON.stringify(stats, null, 2), "utf-8");
  } catch {}
}

function summaryFile(): string {
  const base = process.env.OPENCLAW_WORKSPACE_DIR || process.cwd();
  const dir = join(base, "memory", "stats");
  return join(dir, "_summary.json");
}

function writeSummary(): void {
  try {
    const all = Array.from(sessions.values());
    const dir = join(process.env.OPENCLAW_WORKSPACE_DIR || process.cwd(), "memory", "stats");
    ensureDir(dir);
    const summary = {
      updatedAt: new Date().toISOString(),
      totalSessions: all.length,
      activeSessions: all.filter(s => !s.endedAt).length,
      sessions: all.map(s => ({
        sessionKey: s.sessionKey,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        messageCount: s.messageCount,
        toolCallCount: s.toolCallCount,
        toolErrors: s.toolErrors,
        subagentSpawns: s.subagentSpawns,
        lastTokenCount: s.lastTokenCount,
      })),
    };
    writeFileSync(summaryFile(), JSON.stringify(summary, null, 2), "utf-8");
  } catch {}
}

function getOrCreate(sessionKey: string, sessionId: string): SessionStats {
  if (!sessions.has(sessionKey)) {
    sessions.set(sessionKey, {
      sessionId,
      sessionKey,
      startedAt: new Date().toISOString(),
      messageCount: 0,
      toolCallCount: 0,
      toolErrors: 0,
      subagentSpawns: 0,
      subagentEnds: 0,
      prePromptsInjected: 0,
      lastTokenCount: 0,
      lastMessageCount: 0,
      compactionEvents: 0,
      events: [],
    });
  }
  return sessions.get(sessionKey)!;
}

export default definePluginEntry({
  id: "context-stats",
  name: "Context Stats",
  description: "Tracks context/token stats across agent lifecycle, writes snapshots to memory/stats/",
  register(api) {
    api.on("session_start", async (event, ctx) => {
      const sk = ctx.sessionKey || "default";
      const stats = getOrCreate(sk, event.sessionId);
      stats.events.push({ ts: new Date().toISOString(), type: "session_start", detail: `resumed=${!!event.resumedFrom}` });
      api.logger.debug(`[context-stats] session_start: ${sk}`);
      return undefined;
    });

    api.on("session_end", async (event, ctx) => {
      const sk = ctx.sessionKey || "default";
      const stats = sessions.get(sk);
      if (stats) {
        stats.endedAt = new Date().toISOString();
        stats.events.push({ ts: new Date().toISOString(), type: "session_end", detail: `messages=${event.messageCount} duration=${event.durationMs}ms` });
        writeSnapshot(sk, stats);
      }
      writeSummary();
      api.logger.debug(`[context-stats] session_end: ${sk}`);
      return undefined;
    });

    api.on("before_prompt_build", async (event, ctx) => {
      const sk = ctx.sessionKey || "default";
      const stats = getOrCreate(sk, "");
      stats.messageCount = (event.messages as unknown[]).length;
      stats.lastTokenCount = countMessageTokens(event.messages as unknown[]);
      stats.lastMessageCount = stats.messageCount;
      stats.prePromptsInjected++;
      stats.events.push({ ts: new Date().toISOString(), type: "before_prompt_build", detail: `msgs=${stats.messageCount} tokens~${stats.lastTokenCount}` });
      writeSnapshot(sk, stats);
      return undefined;
    });

    api.on("after_tool_call", async (event, ctx) => {
      const sk = ctx.sessionKey || "default";
      const stats = sessions.get(sk);
      if (stats) {
        stats.toolCallCount++;
        if (event.error) stats.toolErrors++;
        stats.events.push({ ts: new Date().toISOString(), type: "after_tool_call", detail: `tool=${event.toolName} err=${!!event.error} dur=${event.durationMs}ms` });
        writeSnapshot(sk, stats);
      }
      return undefined;
    });

    api.on("agent_end", async (event, ctx) => {
      const sk = ctx.sessionKey || "default";
      const stats = sessions.get(sk);
      if (stats) {
        const msgs = event.messages as Array<{ role?: string }>;
        stats.messageCount = msgs.length;
        stats.events.push({ ts: new Date().toISOString(), type: "agent_end", detail: `success=${event.success} dur=${event.durationMs}ms msgs=${msgs.length}` });
        writeSnapshot(sk, stats);
        writeSummary();
      }
      return undefined;
    });

    api.on("before_compaction", async (event, ctx) => {
      const sk = ctx.sessionKey || "default";
      const stats = sessions.get(sk);
      if (stats) {
        stats.compactionEvents++;
        stats.lastTokenCount = event.tokenCount;
        stats.events.push({ ts: new Date().toISOString(), type: "before_compaction", detail: `msgs=${event.messageCount} tokens=${event.tokenCount}` });
        writeSnapshot(sk, stats);
      }
      return undefined;
    });

    api.on("after_compaction", async (event, ctx) => {
      const sk = ctx.sessionKey || "default";
      const stats = sessions.get(sk);
      if (stats) {
        stats.lastTokenCount = event.tokenCount;
        stats.lastMessageCount = event.messageCount;
        stats.events.push({ ts: new Date().toISOString(), type: "after_compaction", detail: `remaining=${event.messageCount} tokens=${event.tokenCount}` });
        writeSnapshot(sk, stats);
      }
      return undefined;
    });

    api.on("subagent_spawning", async (event, _ctx) => {
      const parent = _ctx.requesterSessionKey || "unknown";
      const stats = sessions.get(parent);
      if (stats) {
        stats.subagentSpawns++;
        stats.events.push({ ts: new Date().toISOString(), type: "subagent_spawning", detail: `child=${event.childSessionKey} mode=${event.mode}` });
        writeSnapshot(parent, stats);
      }
      return undefined;
    });

    api.on("subagent_ended", async (event, _ctx) => {
      const parent = _ctx.requesterSessionKey || "unknown";
      const stats = sessions.get(parent);
      if (stats) {
        stats.subagentEnds++;
        stats.events.push({ ts: new Date().toISOString(), type: "subagent_ended", detail: `child=${event.targetSessionKey} outcome=${event.outcome}` });
        writeSnapshot(parent, stats);
      }
      return undefined;
    });

    api.on("gateway_stop", async () => {
      writeSummary();
      const all = Array.from(sessions.values());
      const totalToolCalls = all.reduce((a, s) => a + s.toolCallCount, 0);
      const totalErrors = all.reduce((a, s) => a + s.toolErrors, 0);
      api.logger.info(`[context-stats] gateway_stop: ${all.length} sessions tracked, ${totalToolCalls} tool calls, ${totalErrors} errors`);
      return undefined;
    });

    api.logger.info("[context-stats] registered: session_start/end, before_prompt_build, after_tool_call, agent_end, before/after_compaction, subagent_spawning/ended, gateway_stop");
  },
});
