/**
 * Away Summary Plugin
 *
 * Uses before_prompt_build to capture user message text.
 * Saves one-liner on every prompt build (every AI turn).
 * Injects latest summary on session_start.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookBeforePromptBuildEvent,
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
    return readFileSync(join(dir, files[0]), "utf-8").trim();
  } catch {
    return null;
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 50).replace(/\n/g, " ");
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          return b.text.slice(0, 50).replace(/\n/g, " ");
        }
      }
    }
  }
  return "";
}

export default definePluginEntry({
  id: "away-summary",
  name: "Away Summary",
  description: "Capture user message on every prompt build, inject summary on session_start",
  register(api) {
    const cfg = getConfig(api);

    // ── before_prompt_build: capture user message text ───────────────────
    api.on("before_prompt_build", async (
      event: PluginHookBeforePromptBuildEvent,
      _ctx: { sessionKey?: string }
    ) => {
      try {
        const messages = event.messages as Array<{ role?: string; content?: unknown }>;
        if (!messages || messages.length === 0) return undefined;

        // Find last user message
        let userText = "";
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === "user") {
            userText = extractText(msg.content);
            break;
          }
        }

        if (!userText) userText = "[用户活动]";

        const now = new Date();
        const time = now.toTimeString().slice(0, 8);
        const summary = `[${time}] ${userText}`;

        const wsDir = getWorkspaceDir();
        const dir = join(wsDir, cfg.awayDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "last-summary.md"), summary, "utf-8");

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

    api.logger.info("away-summary plugin registered: before_prompt_build, session_start");
  },
});
