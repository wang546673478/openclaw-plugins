/**
 * LLM Logger Plugin
 *
 * Captures llm_input and llm_output hooks to log:
 * - Model/provider info
 * - Token usage (input/output/cache)
 * - Session-level LLM call counts and costs
 *
 * Writes structured logs to workspace memory/llm-logs/ for analytics.
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
} from "openclaw/plugin-sdk/plugins/types.js";

function getLogDir(): string {
  const workspace =
    process.env.OPENCLAW_WORKSPACE ||
    join(process.env.HOME || "/home/hhhh", ".openclaw", "workspace");
  const logDir = join(workspace, "memory", "llm-logs");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function getDateStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// In-memory session stats (reset on gateway restart)
const sessionStats = new Map<
  string,
  {
    llmCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    errors: number;
  }
>();

function getOrInitStats(sessionId: string) {
  if (!sessionStats.has(sessionId)) {
    sessionStats.set(sessionId, {
      llmCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      errors: 0,
    });
  }
  return sessionStats.get(sessionId)!;
}

function logEntry(sessionId: string, level: string, message: string, extra?: Record<string, unknown>) {
  const logDir = getLogDir();
  const file = join(logDir, `llm-${getDateStr()}.jsonl`);
  const entry = {
    ts: new Date().toISOString(),
    sessionId,
    level,
    message,
    ...extra,
  };
  try {
    appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {}
}

export default definePluginEntry({
  id: "llm-logger",
  name: "LLM Logger",
  description:
    "Logs LLM input/output, token usage, and call stats for analytics and debugging",
  register(api) {
    api.on("llm_input", async (
      event: PluginHookLlmInputEvent,
      ctx: { runId?: string; sessionId?: string }
    ) => {
      const sessionId = event.sessionId || "unknown";
      const stats = getOrInitStats(sessionId);
      stats.llmCalls++;
      stats.inputTokens += event.usage?.input ?? 0;

      api.logger.debug(
        `llm_input: provider=${event.provider} model=${event.model} ` +
        `session=${sessionId} promptLen=${event.prompt.length} ` +
        `historyMsgs=${event.historyMessages.length} images=${event.imagesCount}`
      );

      logEntry(sessionId, "info", "llm_input", {
        runId: event.runId,
        provider: event.provider,
        model: event.model,
        promptLength: event.prompt.length,
        historyMessagesCount: event.historyMessages.length,
        imagesCount: event.imagesCount,
        inputTokens: event.usage?.input ?? 0,
      });

      return undefined;
    });

    api.on("llm_output", async (
      event: PluginHookLlmOutputEvent,
      ctx: { runId?: string; sessionId?: string }
    ) => {
      const sessionId = event.sessionId || "unknown";
      const stats = getOrInitStats(sessionId);
      stats.outputTokens += event.usage?.output ?? 0;
      stats.cacheReadTokens += event.usage?.cacheRead ?? 0;
      stats.cacheWriteTokens += event.usage?.cacheWrite ?? 0;

      const textCount = event.assistantTexts?.length ?? 0;

      api.logger.debug(
        `llm_output: provider=${event.provider} model=${event.model} ` +
        `session=${sessionId} texts=${textCount} ` +
        `tokens=in${event.usage?.input ?? 0}_out${event.usage?.output ?? 0}`
      );

      logEntry(sessionId, "info", "llm_output", {
        runId: event.runId,
        provider: event.provider,
        model: event.model,
        assistantTextsCount: textCount,
        inputTokens: event.usage?.input ?? 0,
        outputTokens: event.usage?.output ?? 0,
        cacheReadTokens: event.usage?.cacheRead ?? 0,
        cacheWriteTokens: event.usage?.cacheWrite ?? 0,
        totalTokens: event.usage?.total ?? 0,
      });

      return undefined;
    });

    api.on("session_end", async (
      event: { sessionId?: string; messageCount?: number; durationMs?: number },
      _ctx: { sessionKey?: string }
    ) => {
      const sessionId = event.sessionId || "unknown";
      const stats = sessionStats.get(sessionId);
      if (!stats) return undefined;

      api.logger.info(
        `llm_logger session summary: ${sessionId} ` +
        `calls=${stats.llmCalls} ` +
        `in=${stats.inputTokens} out=${stats.outputTokens} ` +
        `cacheR=${stats.cacheReadTokens} cacheW=${stats.cacheWriteTokens}`
      );

      logEntry(sessionId, "info", "session_summary", {
        messageCount: event.messageCount,
        durationMs: event.durationMs,
        llmCalls: stats.llmCalls,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        cacheReadTokens: stats.cacheReadTokens,
        cacheWriteTokens: stats.cacheWriteTokens,
        errors: stats.errors,
      });

      sessionStats.delete(sessionId);
      return undefined;
    });

    api.on("gateway_start", async () => {
      api.logger.info("llm-logger plugin loaded");
      return undefined;
    });

    api.logger.info(
      "llm-logger registered hooks: llm_input, llm_output, session_end"
    );
  },
});
