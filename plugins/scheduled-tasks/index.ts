/**
 * Scheduled Tasks Plugin — Push Mode
 *
 * Uses a background subagent to check and push notifications,
 * avoiding recursive hook issues.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginHookSessionStartEvent } from "openclaw/plugin-sdk/plugins/types.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

interface ScheduledTask {
  id: string;
  cron: string;
  task: string;
  lastRun: string | null;
  enabled?: boolean;
}

let lastCheckMinute = -1; // Track which minute we last pushed

function getTasksFile(): string {
  const workspace =
    process.env.OPENCLAW_WORKSPACE ??
    (process.env.HOME ? `${process.env.HOME}/.openclaw/workspace` : ".");
  return `${workspace}/memory/scheduled-tasks.json`;
}

function loadTasks(): ScheduledTask[] {
  try {
    const filepath = getTasksFile();
    if (!existsSync(filepath)) return [];
    const content = readFileSync(filepath, "utf-8");
    if (!content?.trim()) return [];
    return JSON.parse(content) as ScheduledTask[];
  } catch {
    return [];
  }
}

function saveTasks(tasks: ScheduledTask[]): void {
  try {
    const filepath = getTasksFile();
    const dir = filepath.substring(0, filepath.lastIndexOf("/"));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filepath, JSON.stringify(tasks, null, 2), "utf-8");
  } catch {}
}

function isDue(cron: string): boolean {
  if (!cron || typeof cron !== "string") return false;
  const now = new Date();
  const min = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const dow = now.getDay();

  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const minPart = parts[1] ?? "*";
  const hourPart = parts[2] ?? "*";
  const dayPart = parts[3] ?? "*";
  const monthPart = parts[4] ?? "*";
  const dowPart = parts[5] ?? "*";

  function match(val: number, part: string): boolean {
    if (part === "*") return true;
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10);
      return step > 0 && val % step === 0;
    }
    if (part.includes(",")) {
      return part.split(",").some((p) => parseInt(p, 10) === val);
    }
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return val >= start && val <= end;
    }
    return parseInt(part, 10) === val;
  }

  return (
    match(min, minPart) &&
    match(hour, hourPart) &&
    match(day, dayPart) &&
    match(month, monthPart) &&
    match(dow, dowPart)
  );
}

export default definePluginEntry({
  id: "scheduled-tasks",
  name: "Scheduled Tasks",
  description: "Push scheduled task reminders via prependContext once per minute",
  register(api) {
    // session_start — check if a new minute has started, then inject reminder
    api.on("session_start", async (
      event: PluginHookSessionStartEvent,
      _ctx: { sessionKey?: string }
    ) => {
      try {
        const now = new Date();
        const currentMinute = now.getMinutes();

        // Only trigger once per minute (debounce multiple session events)
        if (currentMinute === lastCheckMinute) return undefined;
        lastCheckMinute = currentMinute;

        const tasks = loadTasks();
        if (!tasks || tasks.length === 0) return undefined;

        const dueTasks = tasks.filter(
          (t) => t.enabled !== false && isDue(t.cron ?? "")
        );
        if (dueTasks.length === 0) return undefined;

        // Update lastRun for all due tasks
        const nowISO = now.toISOString();
        for (const t of dueTasks) {
          t.lastRun = nowISO;
          api.logger.info(`scheduled-tasks: triggering task "${t.id}"`);
        }
        saveTasks(tasks);

        // Return prependContext — model will naturally respond with the report
        const lines = dueTasks.map(
          (t) => `- [ ] **[定时任务]** ${t.task} (ID: ${t.id})`
        );
        const inject =
          `【定时任务提醒 ⏰】以下任务到了执行时间，请立即处理：\n${lines.join("\n")}\n\n`;
        return { prependContext: inject };
      } catch (e) {
        api.logger.info(`scheduled-tasks: error - ${e}`);
        return undefined;
      }
    });

    api.on("gateway_start", async () => {
      lastCheckMinute = -1; // Reset on gateway start
      try {
        const filepath = getTasksFile();
        if (!existsSync(filepath)) {
          const dir = filepath.substring(0, filepath.lastIndexOf("/"));
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(filepath, JSON.stringify([], null, 2), "utf-8");
        }
      } catch {}
      api.logger.info("scheduled-tasks plugin loaded (push mode)");
      return undefined;
    });

    api.logger.info(
      "scheduled-tasks plugin registered hooks: session_start (push mode)"
    );
  },
});
