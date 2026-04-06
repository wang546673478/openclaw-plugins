/**
 * Loop Detector Plugin
 *
 * Detects when the agent repeatedly calls the same tool with the same parameters,
 * which typically indicates a stuck loop. Uses before_prompt_build to inject
 * a break-loop reminder when a loop was detected in the previous turn.
 *
 * Tracking: after_tool_call (count consecutive identical calls)
 * Injection: before_prompt_build (return prependContext warning)
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookBeforePromptBuildEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugins/types.js";

interface LoopConfig {
  threshold: number;
  windowMs: number;
}

function getConfig(api: { pluginConfig?: Record<string, unknown> }): LoopConfig {
  return {
    threshold: (api.pluginConfig?.threshold as number) || 3,
    windowMs: (api.pluginConfig?.windowMs as number) || 30000,
  };
}

// Track recent tool calls: sessionKey → [{tool, paramsHash, timestamp}]
const recentCalls = new Map<
  string,
  Array<{ tool: string; paramsHash: string; ts: number }>
>();

// Loop state: sessionKey → { tool, paramsHash, count }
const loopState = new Map<
  string,
  { tool: string; paramsHash: string; count: number }
>();

function hashParams(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  try {
    return JSON.stringify(params, Object.keys(params).sort());
  } catch {
    return String(params);
  }
}

export default definePluginEntry({
  id: "loop-detector",
  name: "Loop Detector",
  description:
    "Detect repeated tool calls with identical parameters and inject a break-loop reminder",
  register(api) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = getConfig(api as unknown as { pluginConfig?: Record<string, unknown> });

    // ── after_tool_call: track tool calls ─────────────────────────────
    api.on("after_tool_call", async (
      event: PluginHookAfterToolCallEvent,
      ctx: PluginHookToolContext
    ) => {
      const sessionKey = ctx.sessionKey || "default";
      const toolName = event.toolName;
      const paramsHash = hashParams(
        event.params as Record<string, unknown> | undefined
      );
      const now = Date.now();
      const cutoff = now - cfg.windowMs;

      const calls = recentCalls.get(sessionKey) ?? [];
      const recent = calls.filter((c) => c.ts > cutoff);

      // Count consecutive identical calls
      const consecutive = recent.filter(
        (c) => c.tool === toolName && c.paramsHash === paramsHash
      ).length;

      if (consecutive >= cfg.threshold) {
        loopState.set(sessionKey, { tool: toolName, paramsHash, count: consecutive + 1 });
        api.logger.warn(
          `loop-detector: loop detected for ${toolName} (${consecutive + 1}x, threshold=${cfg.threshold})`
        );
      }

      recent.push({ tool: toolName, paramsHash, ts: now });
      recentCalls.set(sessionKey, recent);
      return undefined;
    });

    // ── before_prompt_build: inject loop warning if detected ──────────
    api.on("before_prompt_build", async (
      _event: PluginHookBeforePromptBuildEvent,
      ctx: { sessionKey?: string }
    ) => {
      const sessionKey = ctx.sessionKey || "default";
      const loop = loopState.get(sessionKey);
      if (!loop) return undefined;

      // Clear so we don't warn every turn
      loopState.delete(sessionKey);

      return {
        prependContext:
          `【循环警告 🔄】检测到工具 \`${loop.tool}\` 被连续调用 ${loop.count} 次，参数相同。` +
          `可能陷入循环。请：1) 检查参数是否正确 2) 尝试不同方法 3) 调用 memory_search 回顾上下文。\n`,
      };
    });

    // Reset on session end
    api.on("session_end", async (_event, ctx) => {
      if (ctx.sessionKey) {
        recentCalls.delete(ctx.sessionKey);
        loopState.delete(ctx.sessionKey);
      }
      return undefined;
    });

    api.on("gateway_start", async () => {
      recentCalls.clear();
      loopState.clear();
      api.logger.info(
        `loop-detector loaded (threshold=${cfg.threshold}, window=${cfg.windowMs}ms)`
      );
      return undefined;
    });

    api.logger.info(
      "loop-detector registered hooks: after_tool_call, before_prompt_build, session_end, gateway_start"
    );
  },
});
