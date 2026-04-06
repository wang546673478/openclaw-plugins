/**
 * Away Summary Plugin
 *
 * Detects user absence on session_end and writes a summary.
 * On next session_start, injects the away summary if available.
 *
 * Saves to memory/away/YYYY-MM-DD.md
 * Injects via prependContext on session_start
 *
 * Corresponds to: Claude Code P4 5.3 Away Summary
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
  minDuration: number;  // ms — minimum session length to qualify
  awayThreshold: number; // ms — inactivity threshold to consider user "away"
  maxSummaries: number;  // max away summaries to keep
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): AwayConfig {
  return {
    awayDir: (api.pluginConfig?.awayDir as string) || "memory/away",
    minDuration: (api.pluginConfig?.minDuration as number) || 60000, // 1 min minimum
    awayThreshold: (api.pluginConfig?.awayThreshold as number) || 300000, // 5 min away
    maxSummaries: (api.pluginConfig?.maxSummaries as number) || 10,
  };
}

function extractText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(c => extractText(c)).join(" ");
  }
  if (typeof content === "object" && content !== null) {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
    if (typeof c.content === "string") return c.content;
  }
  return "";
}

function generateAwaySummary(
  messages: unknown[],
  durationMs: number,
  cfg: AwayConfig
): string {
  const msgs = messages as Array<{ role?: string; content?: unknown; refusal?: unknown }>;
  const userMsgs = msgs.filter(m => m.role === "user" && !m.refusal);
  const assistantMsgs = msgs.filter(m => m.role === "assistant" && !m.refusal);

  if (userMsgs.length === 0) {
    return "会话无用户消息。";
  }

  const durationSec = Math.round(durationMs / 1000);
  const firstTask = extractText(userMsgs[0]?.content).slice(0, 120);
  const lastUserText = extractText(userMsgs[userMsgs.length - 1]?.content).slice(0, 100);

  // Count turns
  const turnCount = userMsgs.length;
  const toolCalls = assistantMsgs.filter(m => {
    const content = m.content;
    if (Array.isArray(content)) {
      return content.some((b: unknown) => typeof b === "object" && (b as Record<string, unknown>)?.type === "tool_call");
    }
    return false;
  }).length;

  // Check if task was completed
  const lastAssistantText = extractText(assistantMsgs[assistantMsgs.length - 1]?.content);
  const completed = lastAssistantText.includes("完成") || lastAssistantText.includes("done") ||
                    lastAssistantText.includes("搞定") || lastAssistantText.includes("好了") ||
                    lastAssistantText.includes("success");

  const lines: string[] = [];
  lines.push(`离开时间：约 ${durationSec}s 前`);
  lines.push(`会话任务：${firstTask}${firstTask.endsWith("。") ? "" : "。"}`);
  if (turnCount > 1) {
    lines.push(`对话轮次：${turnCount} 轮`);
  }
  if (toolCalls > 0) {
    lines.push(`工具调用：${toolCalls} 次`);
  }
  lines.push(`最后用户消息：${lastUserText}${lastUserText.endsWith("。") ? "" : "。"}`);
  lines.push(`任务状态：${completed ? "✅ 完成" : "⏳ 未完成"}`);

  return lines.join(" | ");
}

function getLatestAwayFile(cfg: AwayConfig): { filepath: string; summary: string } | null {
  try {
    const dir = join(process.cwd(), cfg.awayDir);
    if (!existsSync(dir)) return null;

    // Find most recent file
    const files = require("node:fs").readdirSync(dir)
      .filter(f => f.endsWith(".md"))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    const filepath = join(dir, files[0]);
    const content = readFileSync(filepath, "utf-8");

    // Extract content after frontmatter
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

function saveAwaySummary(summary: string, cfg: AwayConfig): void {
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

    const dir = join(process.cwd(), cfg.awayDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filepath = join(dir, `${date}.md`);
    writeFileSync(filepath, content, { flag: "a" });
  } catch {}
}

export default definePluginEntry({
  id: "away-summary",
  name: "Away Summary",
  description: "Write away summary to memory/away/ on session_end (P4 5.3 Away Summary)",
  register(api) {
    const cfg = getConfig(api);

    // ── session_end: write away summary ─────────────────────────────────
    api.on("session_end", async (
      event: PluginHookSessionEndEvent,
      ctx: { sessionKey?: string }
    ) => {
      if (!event.durationMs || event.durationMs < cfg.minDuration) {
        api.logger.debug(`away-summary: session too short (${event.durationMs}ms < ${cfg.minDuration}ms), skipping`);
        return undefined;
      }

      try {
        // Get session messages from event if available
        // Note: sessionEnd may not carry full messages; try to read from session file
        const sessionId = event.sessionId || ctx.sessionKey;
        api.logger.info(`away-summary: session_end sessionId=${sessionId} duration=${Math.round(event.durationMs / 1000)}s`);

        // For now, generate summary from available info
        // In a full implementation we'd read the session JSONL file
        const summary = `会话时长 ${Math.round(event.durationMs / 1000)}s，${event.messageCount} 条消息`;
        saveAwaySummary(summary, cfg);
        api.logger.info(`away-summary: saved away summary`);
      } catch (e) {
        api.logger.info(`away-summary: error on session_end: ${e}`);
      }

      return undefined;
    });

    // ── session_start: inject pending away summary ──────────────────────
    api.on("session_start", async (
      event: PluginHookSessionStartEvent,
      _ctx: { sessionKey?: string }
    ) => {
      try {
        const latest = getLatestAwayFile(cfg);
        if (!latest || !latest.summary) return undefined;

        const inject = `【上次会话摘要】${latest.summary}\n\n`;
        api.logger.info(`away-summary: injecting away summary: "${latest.summary.slice(0, 60)}..."`);
        return { prependContext: inject };
      } catch (e) {
        api.logger.info(`away-summary: error on session_start: ${e}`);
        return undefined;
      }
    });

    api.on("gateway_start", async () => {
      // Ensure away dir exists
      try {
        const dir = join(process.cwd(), cfg.awayDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      } catch {}
      api.logger.info("away-summary plugin loaded");
      return undefined;
    });

    api.logger.info("away-summary plugin registered hooks: session_end, session_start");
  },
});
