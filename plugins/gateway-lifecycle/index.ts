/**
 * Gateway Lifecycle Plugin
 *
 * Tracks gateway startup/shutdown events:
 * - Records gateway start time and uptime on shutdown
 * - Tracks session counts (total, active)
 * - Writes lifecycle events to memory/gateway-lifecycle/
 *
 * Corresponding task: P4 5.2 Background Tasks (gateway lifecycle tracking)
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookGatewayStartEvent,
  PluginHookGatewayStopEvent,
  PluginHookSessionStartEvent,
  PluginHookSessionEndEvent,
} from "openclaw/plugin-sdk/plugins/types.js";

interface LifecycleStats {
  startTime: string;
  startTimeMs: number;
  sessionsStarted: number;
  sessionsEnded: number;
  sessionsReset: number;
  sessionsDeleted: number;
  sessionsIdle: number;
  sessionsNew: number;
  sessionsUnknown: number;
  sessionsCompaction: number;
  sessionsDaily: number;
}

let stats: LifecycleStats | null = null;

function getLogDir(): string {
  const workspace =
    process.env.OPENCLAW_WORKSPACE ||
    join(process.env.HOME || "/home/hhhh", ".openclaw", "workspace");
  const logDir = join(workspace, "memory", "gateway-lifecycle");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function getDateStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function logEntry(level: string, message: string, extra?: Record<string, unknown>) {
  const logDir = getLogDir();
  const file = join(logDir, `lifecycle-${getDateStr()}.jsonl`);
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...extra,
  };
  try {
    appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {}
}

export default definePluginEntry({
  id: "gateway-lifecycle",
  name: "Gateway Lifecycle",
  description:
    "Tracks gateway startup/shutdown, session lifecycle events, and uptime stats",
  register(api) {
    api.on("gateway_start", async (
      event: PluginHookGatewayStartEvent,
      _ctx: { port?: number }
    ) => {
      const now = new Date();
      stats = {
        startTime: now.toISOString(),
        startTimeMs: now.getTime(),
        sessionsStarted: 0,
        sessionsEnded: 0,
        sessionsReset: 0,
        sessionsDeleted: 0,
        sessionsIdle: 0,
        sessionsNew: 0,
        sessionsUnknown: 0,
        sessionsCompaction: 0,
        sessionsDaily: 0,
      };

      api.logger.info(
        `gateway-lifecycle: gateway started on port ${event.port} at ${stats.startTime}`
      );

      logEntry("info", "gateway_start", {
        port: event.port,
        startTime: stats.startTime,
      });

      return undefined;
    });

    api.on("gateway_stop", async (
      event: PluginHookGatewayStopEvent,
      _ctx: { port?: number }
    ) => {
      if (!stats) {
        api.logger.warn("gateway-lifecycle: no stats to flush on stop");
        return undefined;
      }

      const endTime = new Date();
      const uptimeMs = endTime.getTime() - stats.startTimeMs;
      const uptimeSec = Math.round(uptimeMs / 1000);
      const activeSessions = stats.sessionsStarted - stats.sessionsEnded;

      api.logger.info(
        `gateway-lifecycle: gateway stopped after ${uptimeSec}s ` +
        `(reason=${event.reason || "unknown"}) ` +
        `sessions=${stats.sessionsStarted} started / ${stats.sessionsEnded} ended ` +
        `(${stats.sessionsReset} reset, ${stats.sessionsIdle} idle, ` +
        `${stats.sessionsDeleted} deleted, ${stats.sessionsNew} new, ` +
        `${stats.sessionsCompaction} compaction, ${stats.sessionsDaily} daily, ` +
        `${stats.sessionsUnknown} unknown) ` +
        `active=${activeSessions >= 0 ? activeSessions : "unknown"}`
      );

      logEntry("info", "gateway_stop", {
        reason: event.reason,
        endTime: endTime.toISOString(),
        uptimeSeconds: uptimeSec,
        uptimeMs,
        sessionsStarted: stats.sessionsStarted,
        sessionsEnded: stats.sessionsEnded,
        sessionsReset: stats.sessionsReset,
        sessionsDeleted: stats.sessionsDeleted,
        sessionsIdle: stats.sessionsIdle,
        sessionsNew: stats.sessionsNew,
        sessionsUnknown: stats.sessionsUnknown,
        sessionsCompaction: stats.sessionsCompaction,
        sessionsDaily: stats.sessionsDaily,
        activeSessions: activeSessions >= 0 ? activeSessions : null,
      });

      return undefined;
    });

    api.on("session_start", async (
      event: PluginHookSessionStartEvent,
      _ctx: { sessionKey?: string }
    ) => {
      if (!stats) return undefined;
      stats.sessionsStarted++;
      api.logger.debug(
        `gateway-lifecycle: session_start ${event.sessionId} (total started: ${stats.sessionsStarted})`
      );
      return undefined;
    });

    api.on("session_end", async (
      event: PluginHookSessionEndEvent,
      _ctx: { sessionKey?: string }
    ) => {
      if (!stats) return undefined;
      stats.sessionsEnded++;

      const reason = event.reason || "unknown";
      switch (reason) {
        case "reset":
          stats.sessionsReset++;
          break;
        case "deleted":
          stats.sessionsDeleted++;
          break;
        case "idle":
          stats.sessionsIdle++;
          break;
        case "new":
          stats.sessionsNew++;
          break;
        case "compaction":
          stats.sessionsCompaction++;
          break;
        case "daily":
          stats.sessionsDaily++;
          break;
        default:
          stats.sessionsUnknown++;
      }

      api.logger.debug(
        `gateway-lifecycle: session_end ${event.sessionId} reason=${reason} ` +
        `(total ended: ${stats.sessionsEnded})`
      );
      return undefined;
    });

    api.logger.info(
      "gateway-lifecycle registered hooks: gateway_start, gateway_stop, session_start, session_end"
    );
  },
});
