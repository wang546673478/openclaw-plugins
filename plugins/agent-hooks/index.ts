/**
 * Agent Hooks Plugin
 *
 * Registers lifecycle hooks for:
 * - before_prompt_build: inject context before prompt
 * - after_tool_call: log/count tool calls
 * - agent_end: save session summary
 * - session_start / session_end: session lifecycle
 * - subagent_spawning / subagent_ended: subagent lifecycle
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookBeforePromptBuildEvent,
  PluginHookAfterToolCallEvent,
  PluginHookAgentEndEvent,
  PluginHookSessionStartEvent,
  PluginHookSessionEndEvent,
  PluginHookSubagentSpawningEvent,
  PluginHookSubagentEndedEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugins/types.js";

// Simple in-memory stats (reset on gateway restart)
const stats = {
  toolCalls: 0,
  sessionsStarted: 0,
  sessionsEnded: 0,
  subagentsSpawned: 0,
  subagentsEnded: 0,
};

export default definePluginEntry({
  id: "agent-hooks",
  name: "Agent Hooks",
  description: "Agent lifecycle hooks - before_prompt_build, after_tool_call, agent_end, session lifecycle",
  register(api) {
    // ── before_prompt_build ─────────────────────────────────────────────
    // Called before each prompt is built. Can inject prependContext / appendSystemContext.
    api.on("before_prompt_build", async (
      event: PluginHookBeforePromptBuildEvent,
      ctx: { sessionKey?: string; trigger?: string }
    ) => {
      api.logger.debug(`before_prompt_build: session=${ctx.sessionKey} trigger=${ctx.trigger} messages=${(event.messages as unknown[]).length}`);

      // Example: inject reminder about memory for long sessions
      const msgCount = (event.messages as unknown[]).length;
      if (msgCount > 20) {
        return {
          prependContext: "【记忆提醒】这是一个长对话。请在适当时机使用 memory_search 工具检索历史记忆。\n",
        };
      }

      return undefined;
    });

    // ── after_tool_call ──────────────────────────────────────────────────
    // Called after each tool completes. Useful for logging, counting, or side effects.
    api.on("after_tool_call", async (
      event: PluginHookAfterToolCallEvent,
      ctx: PluginHookToolContext
    ) => {
      stats.toolCalls++;
      api.logger.debug(`after_tool_call: tool=${event.toolName} session=${ctx.sessionKey} duration=${event.durationMs}ms`);

      if (event.error) {
        api.logger.warn(`Tool ${event.toolName} failed: ${event.error}`);
      }

      return undefined;
    });

    // ── agent_end ─────────────────────────────────────────────────────────
    // Called when an agent run ends. Good for cleanup, saving summaries.
    api.on("agent_end", async (
      event: PluginHookAgentEndEvent,
      ctx: { sessionKey?: string; trigger?: string }
    ) => {
      api.logger.info(`agent_end: session=${ctx.sessionKey} success=${event.success} duration=${event.durationMs}ms`);

      // Count message types
      const messages = event.messages as Array<{ role?: string }>;
      const userMsgs = messages.filter(m => m.role === "user").length;
      const assistantMsgs = messages.filter(m => m.role === "assistant").length;

      // Log summary (in production you'd write to memory/)
      if (event.durationMs && event.durationMs > 60000) {
        api.logger.info(`Long session summary: ${userMsgs} user msgs, ${assistantMsgs} assistant msgs, ${stats.toolCalls} tool calls`);
      }

      return undefined;
    });

    // ── session_start ─────────────────────────────────────────────────────
    api.on("session_start", async (
      event: PluginHookSessionStartEvent,
      _ctx: { sessionKey?: string }
    ) => {
      stats.sessionsStarted++;
      api.logger.info(`session_start: sessionId=${event.sessionId} sessionKey=${event.sessionKey} resumed=${!!event.resumedFrom}`);
      return undefined;
    });

    // ── session_end ───────────────────────────────────────────────────────
    api.on("session_end", async (
      event: PluginHookSessionEndEvent,
      _ctx: { sessionKey?: string }
    ) => {
      stats.sessionsEnded++;
      api.logger.info(`session_end: sessionId=${event.sessionId} messages=${event.messageCount} duration=${event.durationMs}ms`);
      return undefined;
    });

    // ── subagent_spawning ────────────────────────────────────────────────
    api.on("subagent_spawning", async (
      event: PluginHookSubagentSpawningEvent,
      _ctx: { requesterSessionKey?: string }
    ) => {
      api.logger.info(`subagent_spawning: child=${event.childSessionKey} mode=${event.mode} thread=${event.threadRequested}`);
      return undefined;
    });

    // ── subagent_ended ───────────────────────────────────────────────────
    api.on("subagent_ended", async (
      event: PluginHookSubagentEndedEvent,
      _ctx: { requesterSessionKey?: string }
    ) => {
      stats.subagentsEnded++;
      api.logger.info(`subagent_ended: target=${event.targetSessionKey} outcome=${event.outcome} reason=${event.reason}`);
      return undefined;
    });

    // ── gateway_start ─────────────────────────────────────────────────────
    api.on("gateway_start", async () => {
      api.logger.info("agent-hooks plugin loaded");
      return undefined;
    });

    // ── gateway_stop ─────────────────────────────────────────────────────
    api.on("gateway_stop", async () => {
      api.logger.info(`agent-hooks stats: toolCalls=${stats.toolCalls} sessions=${stats.sessionsStarted}/${stats.sessionsEnded} subagents=${stats.subagentsSpawned}/${stats.subagentsEnded}`);
      return undefined;
    });

    api.logger.info("agent-hooks plugin registered hooks: before_prompt_build, after_tool_call, agent_end, session_start, session_end, subagent_spawning, subagent_ended");
  },
});
