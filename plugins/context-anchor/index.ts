/**
 * Context Anchor Plugin
 *
 * Tracks active context (recent files, tools, task) during a conversation
 * and injects a brief reminder before each prompt to reduce repetition
 * and help the agent maintain orientation in long sessions.
 *
 * Tracks:
 * - Recent file operations (read/write/edit targets)
 * - Tool call sequence (last 5 non-query tools)
 * - Conversation message count
 *
 * Injects via before_prompt_build when:
 * - Session has > N messages (configurable, default 20)
 * - An "anchor" has been established (file edit or 3+ tool calls)
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookBeforePromptBuildEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugins/types.js";

interface AnchorConfig {
  messageThreshold: number;
  maxRecentTools: number;
  maxRecentFiles: number;
}

function getConfig(api: { pluginConfig?: Record<string, unknown> }): AnchorConfig {
  return {
    messageThreshold: (api.pluginConfig?.messageThreshold as number) || 20,
    maxRecentTools: (api.pluginConfig?.maxRecentTools as number) || 5,
    maxRecentFiles: (api.pluginConfig?.maxRecentFiles as number) || 5,
  };
}

// In-memory anchor state per session
const sessionState = new Map<
  string,
  {
    messages: number;
    recentTools: string[];
    recentFiles: Set<string>;
    taskHint: string;
  }
>();

function getOrInitState(sessionKey: string) {
  if (!sessionState.has(sessionKey)) {
    sessionState.set(sessionKey, {
      messages: 0,
      recentTools: [],
      recentFiles: new Set(),
      taskHint: "",
    });
  }
  return sessionState.get(sessionKey)!;
}

const FILE_TOOL_NAMES = new Set([
  "read", "write", "edit", "exec",
  "create", "delete", "move", "copy",
  "image", "video_frames",
]);

function buildAnchorText(state: ReturnType<typeof getOrInitState>): string {
  const parts: string[] = [];

  if (state.recentFiles.size > 0) {
    const files = [...state.recentFiles].slice(-5);
    parts.push(`**Recent files**: ${files.join(" → ")}`);
  }

  if (state.recentTools.length > 0) {
    const tools = state.recentTools.slice(-5);
    parts.push(`**Recent tools**: ${tools.join(" → ")}`);
  }

  if (parts.length === 0) return "";

  return (
    `【Context Anchor 🔗】${parts.join(" | ")}\n` +
    `继续当前任务，避免重复操作。\n`
  );
}

export default definePluginEntry({
  id: "context-anchor",
  name: "Context Anchor",
  description:
    "Track recent files/tools and inject context reminders before prompts in long sessions",
  register(api) {
    const cfg = getConfig(api);

    // ── after_tool_call: update anchor state ──────────────────────────
    api.on("after_tool_call", async (
      event: PluginHookAfterToolCallEvent,
      ctx: PluginHookToolContext
    ) => {
      const sk = ctx.sessionKey || "default";
      const state = getOrInitState(sk);
      state.messages++;

      const toolName = event.toolName;
      state.recentTools.push(toolName);
      if (state.recentTools.length > cfg.maxRecentTools * 2) {
        state.recentTools = state.recentTools.slice(-cfg.maxRecentTools);
      }

      // Track file targets from file-related tools
      if (FILE_TOOL_NAMES.has(toolName)) {
        const params = event.params as Record<string, unknown> | undefined;
        const filePath = (params?.file as string) ||
          (params?.path as string) ||
          (params?.target as string) ||
          (params?.url as string);
        if (filePath && typeof filePath === "string" && !filePath.startsWith("--")) {
          const basename = filePath.split("/").pop() || filePath;
          state.recentFiles.add(basename);
          if (state.recentFiles.size > cfg.maxRecentFiles) {
            const arr = [...state.recentFiles];
            arr.shift();
            state.recentFiles = new Set(arr);
          }
        }
      }

      return undefined;
    });

    // ── before_prompt_build: inject anchor reminder ───────────────────
    api.on("before_prompt_build", async (
      _event: PluginHookBeforePromptBuildEvent,
      ctx: { sessionKey?: string }
    ) => {
      const sk = ctx.sessionKey || "default";
      const state = sessionState.get(sk);
      if (!state) return undefined;

      // Only inject if above message threshold and anchor exists
      if (state.messages < cfg.messageThreshold) return undefined;
      if (state.recentFiles.size === 0 && state.recentTools.length < 3) return undefined;

      const anchor = buildAnchorText(state);
      if (!anchor) return undefined;

      return { prependContext: anchor };
    });

    // ── session_end: clean up state ───────────────────────────────────
    api.on("session_end", async (_evt, ctx) => {
      if (ctx.sessionKey) sessionState.delete(ctx.sessionKey);
      return undefined;
    });

    // ── gateway_start: init ────────────────────────────────────────────
    api.on("gateway_start", async () => {
      sessionState.clear();
      api.logger.info(
        `context-anchor loaded (msgThreshold=${cfg.messageThreshold}, ` +
        `maxTools=${cfg.maxRecentTools}, maxFiles=${cfg.maxRecentFiles})`
      );
      return undefined;
    });

    api.logger.info(
      "context-anchor registered hooks: after_tool_call, before_prompt_build, session_end, gateway_start"
    );
  },
});
