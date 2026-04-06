/**
 * Coordinator Plugin (P1 2.1 Coordinator Mode)
 *
 * Provides tools for multi-agent coordination:
 * - coordinator_fork: route a task to a specialized agent type
 * - coordinator_aggregate: combine multiple results into one response
 * - coordinator_status: check subagent session status
 * - coordinator_fork_join: coordinate parallel execution of multiple tasks
 *
 * Integrates with the existing coordinator SKILL.md
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { readFileSync, existsSync } from "node:fs";

interface CoordinatorConfig {
  enabled: boolean;
  maxParallel: number;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): CoordinatorConfig {
  return {
    enabled: api.pluginConfig?.enabled !== false,
    maxParallel: (api.pluginConfig?.maxParallel as number) || 5,
  };
}

function getSubagentResults(): Array<{ sessionKey: string; outcome: string; result: string; endedAt: string }> {
  try {
    const path = `${process.cwd()}/memory/subagent-results.json`;
    if (!existsSync(path)) return [];
    const content = readFileSync(path, "utf-8");
    if (!content?.trim()) return [];
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export default definePluginEntry({
  id: "coordinator",
  name: "Coordinator",
  description: "Multi-agent coordination tools for parallel spawning and result aggregation (P1 2.1)",
  register(api) {
    const cfg = getConfig(api);

    // ── coordinator_fork ─────────────────────────────────────────────────
    api.registerTool({
      name: "coordinator_fork",
      description: "Route a task to a specialized agent type for parallel execution",
      parameters: {},
      async execute(_id, params: { task?: string; agentType?: string; priority?: string }) {
        const task = params?.task || "";
        const agentType = params?.agentType || "general";
        const priority = params?.priority || "normal";

        const agentPrompts: Record<string, string> = {
          coding: "你是一个专注于编码任务的 AI 子代理。请只完成以下编码任务，不需要额外解释。",
          research: "你是一个专注于研究的信息检索 AI 子代理。请系统性地收集和分析信息。",
          writing: "你是一个专注于写作的 AI 子代理。请按照要求完成写作任务。",
          analysis: "你是一个专注于分析的 AI 子代理。请深入分析问题并提供见解。",
          general: "你是一个 AI 子代理。请完成以下任务。",
        };

        const basePrompt = agentPrompts[agentType] || agentPrompts.general;
        const priorityNote = priority === "high" ? "\n\n[高优先级] 请尽快完成。" : "";

        const instruction = `${basePrompt}\n\n任务：${task}${priorityNote}\n\n请使用 sessions_spawn 工具以 mode=run 启动子代理执行。`;

        api.logger.info(`coordinator_fork: routed "${task.slice(0, 50)}..." to ${agentType}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              routed: true,
              agentType,
              priority,
              instruction,
              hint: `使用 sessions_spawn tool 启动子代理，task="${task.slice(0, 100)}..."`,
            }),
          }],
        };
      },
    }, { optional: true });

    // ── coordinator_aggregate ─────────────────────────────────────────────
    api.registerTool({
      name: "coordinator_aggregate",
      description: "Aggregate results from multiple subagent sessions into a unified summary",
      parameters: {},
      async execute(_id, params: { format?: string; filterOutcome?: string }) {
        const format = params?.format || "brief";
        const filterOutcome = params?.filterOutcome;

        const results = getSubagentResults();
        if (results.length === 0) {
          return { content: [{ type: "text", text: "没有找到任何子代理结果。" }] };
        }

        const filtered = filterOutcome
          ? results.filter(r => r.outcome === filterOutcome)
          : results;

        if (filtered.length === 0) {
          return { content: [{ type: "text", text: `没有找到 outcome="${filterOutcome}" 的结果。` }] };
        }

        let output: string;
        if (format === "bullets") {
          const bullets = filtered.map(r =>
            `- [${r.outcome}] ${r.result?.slice(0, 100) || "(无结果)"}`
          );
          output = `## 子代理结果汇总（共 ${filtered.length} 个）\n\n${bullets.join("\n")}`;
        } else if (format === "detailed") {
          const sections = filtered.map((r, i) =>
            `### ${i + 1}. ${r.sessionKey}\n**Outcome**: ${r.outcome}\n**结果**: ${r.result}\n**时间**: ${r.endedAt}`
          );
          output = `## 详细汇总\n\n${sections.join("\n\n")}`;
        } else {
          const successes = filtered.filter(r => r.outcome === "success").length;
          const failures = filtered.length - successes;
          const summary = filtered.map(r => r.result?.slice(0, 80) || "(无)").join(" | ");
          output = `## 汇总\n\n共 ${filtered.length} 个子代理，✅成功 ${successes}，❌失败 ${failures}\n\n${summary}`;
        }

        api.logger.info(`coordinator_aggregate: aggregated ${filtered.length} results`);

        return { content: [{ type: "text", text: output }] };
      },
    }, { optional: true });

    // ── coordinator_status ───────────────────────────────────────────────
    api.registerTool({
      name: "coordinator_status",
      description: "Check the status of coordinated subagent tasks",
      parameters: {},
      async execute(_id, _params) {
        const results = getSubagentResults();
        const recent = results.slice(-10);

        const lines = [
          `## 协调状态\n`,
          `总子代理结果数：${results.length}`,
          `最近活动：${recent.length} 个\n`,
          recent.length > 0
            ? recent.map(r => {
                const icon = r.outcome === "success" ? "✅" : r.outcome === "failed" ? "❌" : "⏳";
                return `${icon} ${r.sessionKey.split(":").pop()?.slice(0, 8)} — ${r.outcome} — ${r.endedAt}`;
              }).join("\n")
            : "_无活动_",
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      },
    }, { optional: true });

    // ── coordinator_fork_join ─────────────────────────────────────────────
    api.registerTool({
      name: "coordinator_fork_join",
      description: "Coordinate parallel execution of multiple tasks",
      parameters: {},
      async execute(_id, params: { tasks?: Array<{ id?: string; description?: string; agentType?: string }> }) {
        const tasks = params?.tasks || [];

        if (tasks.length > cfg.maxParallel) {
          return {
            content: [{
              type: "text",
              text: `任务数 ${tasks.length} 超过限制 ${cfg.maxParallel}。请减少并行数量。`,
            }],
          };
        }

        const instructions = tasks.map((t, i) =>
          `[${i + 1}] ${t.agentType || "general"}: ${t.description}`
        ).join("\n");

        const hints = tasks.map(t =>
          `sessions_spawn task="${t.description}", label="coord-${t.id || i}", mode="run"`
        ).join("\n");

        api.logger.info(`coordinator_fork_join: coordinating ${tasks.length} parallel tasks`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              coordination: "fork_join",
              taskCount: tasks.length,
              instructions,
              spawnHints: hints,
              nextStep: "使用以上 spawn hints 启动子代理，完成后用 coordinator_aggregate 汇总",
            }),
          }],
        };
      },
    }, { optional: true });

    api.on("gateway_start", async () => {
      api.logger.info("coordinator plugin loaded — tools: coordinator_fork, coordinator_aggregate, coordinator_status, coordinator_fork_join");
      return undefined;
    });

    api.logger.info("coordinator plugin registered: 4 coordination tools");
  },
});
