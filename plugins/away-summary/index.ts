/**
 * Away Summary Plugin
 *
 * Writes session summary on EVERY agent_end (every AI response cycle).
 * This ensures we capture every conversation.
 * On session_start, injects the most recent away summary.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookAgentEndEvent,
  PluginHookSessionStartEvent,
} from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface AwayConfig {
  awayDir: string;
  maxSummaries: number;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): AwayConfig {
  return {
    awayDir: (api.pluginConfig?.awayDir as string) || "memory/away",
    maxSummaries: (api.pluginConfig?.maxSummaries as number) || 10,
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

function getLatestAwayFile(wsDir: string, cfg: AwayConfig): { filepath: string; summary: string } | null {
  try {
    const dir = join(wsDir, cfg.awayDir);
    if (!existsSync(dir)) return null;

    const files = require("node:fs").readdirSync(dir)
      .filter(f => f.endsWith(".md"))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    const filepath = join(dir, files[0]);
    const content = readFileSync(filepath, "utf-8");

    const lines = content.split("\n");
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        start = i + 1;
        break;
      }
    }
    const summary = lines.slice(start).join("\n").trim();

    return { filepath, summary };
  } catch {
    return null;
  }
}

function saveAwaySummary(summary: string, wsDir: string, cfg: AwayConfig): void {
  try {
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.toTimeString().slice(0, 8);

    const frontmatter = [
      "---",
      `type: away-summary`,
      `date: ${date}`,
      `time: ${time}`,
      "---",
      "",
    ].join("\n");

    const content = frontmatter + summary + "\n";

    const dir = join(wsDir, cfg.awayDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filepath = join(dir, `${date}.md`);
    writeFileSync(filepath, content, { flag: "a" });
  } catch {}
}

export default definePluginEntry({
  id: "away-summary",
  name: "Away Summary",
  description: "Write away summary to memory/away/ on agent_end and inject on session_start",
  register(api) {
    const cfg = getConfig(api);

    // ── agent_end: save summary ─────────────────────────────────────────
    // Fires at the end of EVERY AI response cycle - captures every conversation
    api.on("agent_end", async (
      event: PluginHookAgentEndEvent
    ) => {
      try {
        // Only save if session had meaningful content
        const duration = event.durationMs || 0;
        const messages = event.messageCount || 0;

        // Skip very short/no-op sessions
        if (messages < 2) {
          return undefined;
        }

        const summary = `会话 ${messages} 条消息，耗时 ${Math.round(duration / 1000)}s`;
        const wsDir = getWorkspaceDir();
        saveAwaySummary(summary, wsDir, cfg);
        api.logger.info(`away-summary: saved (messages=${messages}, duration=${duration}ms)`);
      } catch (e) {
        api.logger.info(`away-summary: error on agent_end: ${e}`);
      }

      return undefined;
    });

    // ── session_start: inject most recent away summary ──────────────────
    api.on("session_start", async (
      _event: PluginHookSessionStartEvent
    ) => {
      try {
        const wsDir = getWorkspaceDir();
        const latest = getLatestAwayFile(wsDir, cfg);
        if (!latest || !latest.summary) return undefined;

        const inject = `【上次会话摘要】${latest.summary}\n\n`;
        api.logger.info(`away-summary: injecting away summary: "${latest.summary.slice(0, 60)}..."`);
        return { prependContext: inject };
      } catch (e) {
        api.logger.info(`away-summary: error on session_start: ${e}`);
        return undefined;
      }
    });

    api.logger.info("away-summary plugin registered hooks: agent_end, session_start");
  },
});
