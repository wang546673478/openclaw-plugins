/**
 * Scheduled Tasks Plugin
 *
 * Checks for due scheduled tasks before each prompt.
 * Tasks are stored in memory/scheduled-tasks.json:
 * [
 *   { "id": "daily-report", "cron": "0 9 * * *", "task": "生成每日报告", "lastRun": null }
 * ]
 *
 * When a task is due, injects a reminder into prependContext.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookBeforePromptBuildEvent,
} from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface ScheduledTask {
  id: string;
  cron: string;
  task: string;
  lastRun: string | null;
  enabled?: boolean;
}

function getTasksFile(api: { pluginConfig: Record<string, unknown> }): string {
  const configured = api.pluginConfig?.tasksFile as string | undefined;
  return configured || "memory/scheduled-tasks.json";
}

function loadTasks(api: { pluginConfig: Record<string, unknown> }): ScheduledTask[] {
  try {
    const filepath = join(process.cwd(), getTasksFile(api));
    if (!existsSync(filepath)) return [];
    const content = readFileSync(filepath, "utf-8");
    return JSON.parse(content) as ScheduledTask[];
  } catch {
    return [];
  }
}

function saveTasks(api: { pluginConfig: Record<string, unknown> }, tasks: ScheduledTask[]): void {
  try {
    const filepath = join(process.cwd(), getTasksFile(api));
    writeFileSync(filepath, JSON.stringify(tasks, null, 2));
  } catch (e) {
    api.logger.info(`scheduled-tasks: failed to save: ${e}`);
  }
}

// Simple cron parser — checks if a cron expression matches the current minute/hour/day
// Supports: min hour day month dow
// * = any, 1,2,3 = list, */n = every n
function isDue(cron: string): boolean {
  const now = new Date();
  const min = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const dow = now.getDay();

  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [, minPart, hourPart, dayPart, monthPart, dowPart] = parts;

  function match(val: number, part: string): boolean {
    if (part === "*") return true;
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2));
      return step > 0 && val % step === 0;
    }
    if (part.includes(",")) {
      return part.split(",").some(p => parseInt(p) === val);
    }
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return val >= start && val <= end;
    }
    return parseInt(part) === val;
  }

  return (
    match(min, minPart) &&
    match(hour, hourPart) &&
    match(day, dayPart) &&
    match(month, monthPart) &&
    match(dow, dowPart)
  );
}

function getLastRun(task: ScheduledTask): string {
  if (!task.lastRun) return "从未运行";
  const ago = Date.now() - new Date(task.lastRun).getTime();
  const mins = Math.floor(ago / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}天前`;
  if (hours > 0) return `${hours}小时前`;
  return `${mins}分钟前`;
}

export default definePluginEntry({
  id: "scheduled-tasks",
  name: "Scheduled Tasks",
  description: "Check and inject due scheduled tasks before each prompt",
  register(api) {
    api.on("before_prompt_build", async (
      event: PluginHookBeforePromptBuildEvent,
      _ctx: { trigger?: string }
    ) => {
      const tasks = loadTasks(api);
      const dueTasks = tasks.filter(t => t.enabled !== false && isDue(t.cron));

      if (dueTasks.length === 0) return undefined;

      const now = new Date().toISOString();
      const lines: string[] = [];

      for (const t of dueTasks) {
        // Update lastRun
        t.lastRun = now;
        lines.push(`- [ ] **[定时任务]** ${t.task} (ID: ${t.id}, 上次运行: ${getLastRun(t)})`);
        api.logger.info(`scheduled-tasks: triggering task "${t.id}"`);
      }

      saveTasks(api, tasks);

      const inject = `【定时任务提醒】以下任务到了执行时间：\n${lines.join("\n")}\n\n请处理这些任务。`;

      return { prependContext: inject + "\n" };
    });

    api.on("gateway_start", async () => {
      // Ensure tasks file exists
      try {
        const filepath = join(process.cwd(), getTasksFile(api));
        if (!existsSync(filepath)) {
          const initial: ScheduledTask[] = [
            {
              id: "example-hourly",
              cron: "0 * * * *",
              task: "[示例] 每小时检查：检查系统状态",
              lastRun: null,
              enabled: false,
            },
          ];
          writeFileSync(filepath, JSON.stringify(initial, null, 2));
        }
      } catch {}
      api.logger.info("scheduled-tasks plugin loaded");
      return undefined;
    });

    api.logger.info("scheduled-tasks plugin registered hooks: before_prompt_build");
  },
});
