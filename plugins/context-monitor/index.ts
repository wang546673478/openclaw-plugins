/**
 * Context Monitor Plugin — compactWarningHook implementation
 *
 * Monitors conversation context growth and injects early warnings
 * BEFORE compaction threshold is reached (the "compactWarningHook").
 *
 * Strategy: track message velocity (growth rate) rather than absolute counts.
 * If context is growing fast, warn early so the agent flushes memory proactively.
 *
 * Claude Code equivalent: PreCompact hook with circuit breaker logic
 * OpenClaw gap: no pre-threshold warning → this fills that gap
 *
 * Tracks per-session:
 * - Message counts over time (velocity)
 * - Last compaction token count
 * - Warning state (suppresses duplicate warnings)
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforeCompactionEvent,
  PluginHookSessionEndEvent,
  PluginHookSessionStartEvent,
  PluginHookAfterCompactionEvent,
} from "openclaw/plugin-sdk/plugins/types.js";

interface ContextMonitorConfig {
  /** Warn if messages grow by this many in one turn */
  velocityThreshold: number;
  /** Warn if total messages exceed this (absolute early threshold) */
  absoluteThreshold: number;
  /** Cooldown between warnings (ms) */
  warningCooldownMs: number;
  /** Minimum messages before warnings start */
  minMessages: number;
}

function getConfig(api: { pluginConfig?: Record<string, unknown> }): ContextMonitorConfig {
  const cfg = api.pluginConfig ?? {};
  return {
    velocityThreshold: (cfg.velocityThreshold as number) ?? 3,
    absoluteThreshold: (cfg.absoluteThreshold as number) ?? 40,
    warningCooldownMs: (cfg.warningCooldownMs as number) ?? 120_000,
    minMessages: (cfg.minMessages as number) ?? 15,
  };
}

interface SessionState {
  messageHistory: number[];        // message counts at each turn
  lastWarningTs: number;           // last warning timestamp
  lastCompactionTs: number;        // when compaction last ran
  turnsSinceCompaction: number;     // turns since last compaction
  warnedVelocity: boolean;         // velocity warning already given
  warnedAbsolute: boolean;         // absolute warning already given
}

const sessions = new Map<string, SessionState>();

function getSessionState(sessionKey: string): SessionState {
  if (!sessions.has(sessionKey)) {
    sessions.set(sessionKey, {
      messageHistory: [],
      lastWarningTs: 0,
      lastCompactionTs: 0,
      turnsSinceCompaction: 0,
      warnedVelocity: false,
      warnedAbsolute: false,
    });
  }
  return sessions.get(sessionKey)!;
}

// ── before_prompt_build: core monitoring logic ──────────────────────────
export default definePluginEntry({
  id: "context-monitor",
  name: "Context Monitor",
  description:
    "Monitors context growth velocity and injects early warnings before compaction threshold — the compactWarningHook",
  register(api) {
    const cfg = getConfig(api);

    // ── session_start: init session state ─────────────────────────────
    api.on("session_start", async (
      _event: PluginHookSessionStartEvent,
      ctx: { sessionKey?: string }
    ) => {
      const sk = ctx.sessionKey || "default";
      sessions.set(sk, {
        messageHistory: [],
        lastWarningTs: 0,
        lastCompactionTs: 0,
        turnsSinceCompaction: 0,
        warnedVelocity: false,
        warnedAbsolute: false,
      });
      api.logger.debug(`context-monitor: session start ${sk}`);
      return undefined;
    });

    // ── before_prompt_build: check velocity + absolute thresholds ─────
    api.on("before_prompt_build", async (
      event: PluginHookBeforePromptBuildEvent,
      ctx: { sessionKey?: string }
    ) => {
      const sk = ctx.sessionKey || "default";
      const state = getSessionState(sk);
      const msgCount = (event.messages as unknown[]).length;
      const now = Date.now();

      // Update history
      state.messageHistory.push(msgCount);
      // Keep last 5 data points
      if (state.messageHistory.length > 5) state.messageHistory.shift();
      state.turnsSinceCompaction++;

      const prepends: string[] = [];

      // ── Velocity check ──────────────────────────────────────────────
      if (state.messageHistory.length >= 2) {
        const prev = state.messageHistory[state.messageHistory.length - 2];
        const curr = msgCount;
        const growth = curr - prev;

        if (growth >= cfg.velocityThreshold && !state.warnedVelocity) {
          const cooldownOk = now - state.lastWarningTs > cfg.warningCooldownMs;
          if (cooldownOk) {
            prepends.push(
              `【⚠️ 上下文增速警告】本轮新增 ${growth} 条消息（阈值 ${cfg.velocityThreshold}），` +
              `上下文增长较快。请在适当时机使用 memory_search 检索旧记忆，或主动调用 compaction 整理上下文。\n`
            );
            state.warnedVelocity = true;
            state.lastWarningTs = now;
            api.logger.info(
              `context-monitor: velocity warning for ${sk} (growth=${growth}, msgCount=${msgCount})`
            );
          }
        }
      }

      // ── Absolute threshold check ───────────────────────────────────
      if (
        msgCount >= cfg.absoluteThreshold &&
        !state.warnedAbsolute &&
        msgCount >= cfg.minMessages
      ) {
        const cooldownOk = now - state.lastWarningTs > cfg.warningCooldownMs;
        if (cooldownOk) {
          prepends.push(
            `【⚠️ 上下文规模警告】当前 ${msgCount} 条消息，接近压缩阈值。` +
            `请利用 memory_search 检索已用记忆，并考虑将重要结论保存到 MEMORY.md，减小上下文压力。\n`
          );
          state.warnedAbsolute = true;
          state.lastWarningTs = now;
          api.logger.info(`context-monitor: absolute warning for ${sk} (msgCount=${msgCount})`);
        }
      }

      // ── Post-compaction reset: re-enable warnings ───────────────────
      // If compaction happened, reset warning flags after enough new turns
      if (state.turnsSinceCompaction > 5) {
        state.warnedVelocity = false;
        state.warnedAbsolute = false;
      }

      if (prepends.length > 0) {
        return { prependContext: prepends.join("") };
      }
      return undefined;
    });

    // ── before_compaction: record compaction timestamp ────────────────
    api.on("before_compaction", async (
      _event: PluginHookBeforeCompactionEvent,
      ctx: { sessionKey?: string }
    ) => {
      const sk = ctx.sessionKey || "default";
      const state = getSessionState(sk);
      state.lastCompactionTs = Date.now();
      api.logger.debug(`context-monitor: compaction approaching for ${sk}`);
      return undefined;
    });

    // ── after_compaction: reset velocity tracking ─────────────────────
    api.on("after_compaction", async (
      _event: PluginHookAfterCompactionEvent,
      ctx: { sessionKey?: string }
    ) => {
      const sk = ctx.sessionKey || "default";
      const state = getSessionState(sk);
      state.lastCompactionTs = Date.now();
      state.turnsSinceCompaction = 0;
      // Keep warned flags but they'll clear after 5 new turns
      api.logger.debug(`context-monitor: compaction done for ${sk}, resets velocity tracking`);
      return undefined;
    });

    // ── session_end: cleanup ──────────────────────────────────────────
    api.on("session_end", async (
      _event: PluginHookSessionEndEvent,
      ctx: { sessionKey?: string }
    ) => {
      if (ctx.sessionKey) {
        sessions.delete(ctx.sessionKey);
      }
      return undefined;
    });

    api.on("gateway_start", async () => {
      sessions.clear();
      api.logger.info(
        `context-monitor loaded (velocityThreshold=${cfg.velocityThreshold}, ` +
        `absoluteThreshold=${cfg.absoluteThreshold}, minMessages=${cfg.minMessages})`
      );
      return undefined;
    });

    api.logger.info(
      "context-monitor registered: session_start, before_prompt_build, " +
      "before_compaction, after_compaction, session_end, gateway_start"
    );
  },
});
