/**
 * Away Summary Plugin
 *
 * Saves a one-liner summary on EVERY user message received.
 * Injects the latest summary on session_start.
 * No cron needed!
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookMessageReceivedEvent,
  PluginHookSessionStartEvent,
} from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface AwayConfig {
  awayDir: string;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): AwayConfig {
  return {
    awayDir: (api.pluginConfig?.awayDir as string) || "memory/away",
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
    if (c && existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

function getLatestSummary(wsDir: string, cfg: AwayConfig): string | null {
  try {
    const dir = join(wsDir, cfg.awayDir);
    if (!existsSync(dir)) return null;
    const files = require("node:fs").readdirSync(dir).filter(f => f === "last-summary.md");
    if (files.length === 0) return null;
    const filepath = join(dir, files[0]);
    return readFileSync(filepath, "utf-8").trim();
  } catch {
    return null;
  }
}

export default definePluginEntry({
  id: "away-summary",
  name: "Away Summary",
  description: "Save one-liner summary on every user message, inject on session_start",
  register(api) {
    const cfg = getConfig(api);

    // ── message_received: save one-liner on every user message ─────────────
    api.on("message_received", async (
      event: PluginHookMessageReceivedEvent,
      ctx: { sessionKey?: string }
    ) => {
      try {
        const wsDir = getWorkspaceDir();
        const dir = join(wsDir, cfg.awayDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const now = new Date();
        const time = now.toTimeString().slice(0, 8);

        // Feishu maps plainText to envelope.content
        let userText = "[用户活动]";
        const obj = event as Record<string, unknown>;
        const envelope = obj?.envelope as Record<string, unknown> | undefined;
        const content = envelope?.content;
        if (typeof content === "string") {
          userText = content.slice(0, 50).replace(/\n/g, " ");
        } else if (content instanceof Uint8Array) {
          try {
            userText = new TextDecoder().decode(content).slice(0, 50).replace(/\n/g, " ");
          } catch {}
        }

        const summary = `[${time}] ${userText || "用户消息"}`;
        const filepath = join(dir, "last-summary.md");
        writeFileSync(filepath, summary, "utf-8");

        api.logger.debug(`away-summary: saved "${summary.slice(0, 40)}..."`);
      } catch (e) {
        api.logger.debug(`away-summary: error: ${e}`);
      }

      return undefined;
    });

    // ── session_start: inject latest summary ───────────────────────────
    api.on("session_start", async (
      _event: PluginHookSessionStartEvent
    ) => {
      try {
        const wsDir = getWorkspaceDir();
        const latest = getLatestSummary(wsDir, cfg);
        if (!latest) return undefined;

        const inject = `【上次会话】${latest}\n\n`;
        api.logger.info(`away-summary: injecting "${latest.slice(0, 50)}..."`);
        return { prependContext: inject };
      } catch (e) {
        api.logger.debug(`away-summary: error: ${e}`);
        return undefined;
      }
    });

    api.logger.info("away-summary plugin registered: message_received, session_start");
  },
});
