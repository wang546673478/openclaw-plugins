/**
 * Away Summary Plugin
 *
 * Detects user absence on session_end and writes a summary.
 * On next session_start, injects the away summary if available.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookSessionEndEvent,
  PluginHookSessionStartEvent,
} from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface AwayConfig {
  awayDir: string;
  minDuration: number;
  awayThreshold: number;
  maxSummaries: number;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): AwayConfig {
  return {
    awayDir: (api.pluginConfig?.awayDir as string) || "memory/away",
    minDuration: (api.pluginConfig?.minDuration as number) || 60000,
    awayThreshold: (api.pluginConfig?.awayThreshold as number) || 300000,
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
  description: "Write away summary to memory/away/ on session_end and inject on next session_start",
  register(api) {
    const cfg = getConfig(api);

    api.on("session_end", async (
      event: PluginHookSessionEndEvent
    ) => {
      if (!event.durationMs || event.durationMs < cfg.minDuration) {
        api.logger.debug(`away-summary: session too short (${event.durationMs}ms < ${cfg.minDuration}ms), skipping`);
        return undefined;
      }

      try {
        const summary = `会话时长 ${Math.round(event.durationMs / 1000)}s，${event.messageCount} 条消息`;
        const wsDir = getWorkspaceDir();
        saveAwaySummary(summary, wsDir, cfg);
        api.logger.info(`away-summary: saved away summary`);
      } catch (e) {
        api.logger.info(`away-summary: error on session_end: ${e}`);
      }

      return undefined;
    });

    api.on("session_start", async (
      event: PluginHookSessionStartEvent
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

    api.logger.info("away-summary plugin registered hooks: session_end, session_start");
  },
});
