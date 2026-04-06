/**
 * Compact Plugin (P0 0.0 Compact System)
 *
 * Three-layer context compaction:
 * - Layer 1 (Warning): Token > warningThreshold → inject memory flush reminder
 * - Layer 2 (MicroCompact): Token > microCompactThreshold → suggest lightweight compaction
 * - Layer 3 (Full Compact): Auto-compaction handled by OpenClaw core (not plugin)
 *
 * Note: Actual message compression is handled by OpenClaw's internal compact.
 * This plugin provides warning layers and manual trigger tool.
 *
 * Architecture limitation: before_compaction fires AFTER OpenClaw decides to compact,
 * not before. True "intercept and control" requires core modification.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginHookBeforeCompactionEvent, PluginHookAfterCompactionEvent } from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface CompactConfig {
  warningThreshold: number;
  microCompactThreshold: number;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): CompactConfig {
  return {
    warningThreshold: (api.pluginConfig?.warningThreshold as number) || 15000,
    microCompactThreshold: (api.pluginConfig?.microCompactThreshold as number) || 20000,
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

export default definePluginEntry({
  id: "compact",
  name: "Compact",
  description: "Three-layer context compaction: warning + microCompact + tool (P0 0.0)",
  register(api) {
    const cfg = getConfig(api);

    // ── before_compaction: inject memory flush reminder ─────────────────
    api.on("before_compaction", async (
      event: PluginHookBeforeCompactionEvent,
      ctx: { sessionKey?: string }
    ) => {
      const tokens = event.tokenCount;
      const messages = event.messageCount;

      api.logger.info(`compact: before_compaction session=${ctx.sessionKey} tokens=${tokens} messages=${messages}`);

      const prepends: string[] = [];

      // Layer 1: Warning
      if (tokens > cfg.warningThreshold) {
        prepends.push(
          `【上下文压缩警告】当前上下文已达 ~${tokens} tokens，接近压缩阈值。\n` +
          `请将本轮重要信息保存到 memory 文件（MEMORY.md 或 memory/YYYY-MM-DD.md）。\n`
        );
      }

      // Layer 2: MicroCompact suggestion
      if (tokens > cfg.microCompactThreshold) {
        prepends.push(
          `【建议轻量压缩】上下文较大，建议使用 \`compact\` 工具手动触发轻度压缩。\n`
        );
      }

      if (prepends.length > 0) {
        api.logger.info(`compact: injected ${prepends.length} warnings (tokens=${tokens})`);
        return { prependContext: prepends.join("\n") };
      }

      return undefined;
    });

    // ── after_compaction: verify and log ──────────────────────────────
    api.on("after_compaction", async (
      event: PluginHookAfterCompactionEvent,
      ctx: { sessionKey?: string }
    ) => {
      api.logger.info(
        `compact: after_compaction session=${ctx.sessionKey} ` +
        `compacted=${event.compactedCount} remaining=${event.messageCount} ` +
        `tokens=~${event.tokenCount}`
      );

      // Log compaction event to memory
      try {
        const wsDir = getWorkspaceDir();
        const dir = join(wsDir, "memory");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const filepath = join(dir, "compact-log.md");
        const entry = `## ${new Date().toISOString()}\n\nCompacted ${event.compactedCount} messages → ~${event.tokenCount} tokens\n\n`;
        writeFileSync(filepath, entry, { flag: "a" });
      } catch {}

      return undefined;
    });

    // ── compact tool: manual lightweight compaction trigger ──────────────
    // Note: This doesn't perform actual compression, but helps the user
    // understand when to use OpenClaw's built-in /compact command
    api.registerTool({
      name: "compact",
      description: "Check context compaction status and get recommendations. Use /compact command in chat to trigger actual compaction.",
      parameters: {},
      async execute(_id, _params) {
        return {
          content: [{
            type: "text",
            text: `【上下文压缩状态】

当前 OpenClaw 的 compaction 由系统自动触发：
- Layer 1（警告）：上下文 > 15,000 tokens 时注入记忆保存提醒
- Layer 2（建议）：> 20,000 tokens 时建议手动压缩

如需触发压缩，请在聊天中发送 /compact

如需查看今日压缩记录：memory/compact-log.md`,
          }],
        };
      },
    }, { optional: true });

    api.logger.info("compact plugin registered: before_compaction, after_compaction, compact tool");
  },
});
