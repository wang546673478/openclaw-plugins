/**
 * Subagent Aggregate Plugin
 *
 * Listens to subagent_ended events and collects results.
 * Results are stored in memory/subagent-results.json for the parent agent to read.
 *
 * Parent agent can call memory_search with "subagent results" to get aggregated results.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookSubagentEndedEvent,
  PluginHookAgentEndEvent,
} from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface SubagentResult {
  sessionKey: string;
  outcome: string;
  reason: string;
  duration?: number;
  endedAt: string;
  error?: string;
}

function getAggregateFile(api: { pluginConfig: Record<string, unknown> }): string {
  const configured = api.pluginConfig?.aggregateFile as string | undefined;
  return configured || "memory/subagent-results.json";
}

function loadResults(api: { pluginConfig: Record<string, unknown> }): SubagentResult[] {
  try {
    const filepath = join(process.cwd(), getAggregateFile(api));
    if (!existsSync(filepath)) return [];
    const content = readFileSync(filepath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

function saveResults(api: { pluginConfig: Record<string, unknown> }, results: SubagentResult[]): void {
  try {
    const dir = join(process.cwd(), "memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filepath = join(process.cwd(), getAggregateFile(api));
    writeFileSync(filepath, JSON.stringify(results, null, 2));
  } catch (e) {
    api.logger.info(`subagent-aggregate: failed to save: ${e}`);
  }
}

export default definePluginEntry({
  id: "subagent-aggregate",
  name: "Subagent Aggregate",
  description: "Collect subagent results on subagent_ended for parent agent retrieval",
  register(api) {
    // subagent_ended — collect result
    api.on("subagent_ended", async (
      event: PluginHookSubagentEndedEvent,
      _ctx: { requesterSessionKey?: string }
    ) => {
      const results = loadResults(api);

      results.push({
        sessionKey: event.targetSessionKey,
        outcome: event.outcome || "unknown",
        reason: event.reason || "",
        duration: event.endedAt
          ? (Date.now() - event.endedAt)
          : undefined,
        endedAt: new Date().toISOString(),
        error: event.error,
      });

      // Keep only last 50 results
      if (results.length > 50) results.splice(0, results.length - 50);

      saveResults(api, results);
      api.logger.info(`subagent-aggregate: collected result for ${event.targetSessionKey} outcome=${event.outcome}`);
      return undefined;
    });

    // agent_end — provide summary to parent
    // The parent agent can read memory/subagent-results.json directly
    api.on("agent_end", async (
      event: PluginHookAgentEndEvent,
      _ctx: { sessionKey?: string }
    ) => {
      const results = loadResults(api);
      const recent = results.slice(-10);

      if (recent.length > 0) {
        api.logger.info(`subagent-aggregate: ${recent.length} recent subagent results available`);
      }
      return undefined;
    });

    api.on("gateway_start", async () => {
      api.logger.info("subagent-aggregate plugin loaded");
      return undefined;
    });

    api.logger.info("subagent-aggregate plugin registered hooks: subagent_ended, agent_end");
  },
});
