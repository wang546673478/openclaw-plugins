/**
 * Brief Tool Plugin
 *
 * Generates 1-3 sentence session summary on agent_end.
 * Saves to memory/brief/YYYY-MM-DD.md for later retrieval.
 *
 * Corresponds to: Claude Code P0 1.4 BriefTool
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginHookAgentEndEvent } from "openclaw/plugin-sdk/plugins/types.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface BriefConfig {
  briefDir: string;
  minDuration: number; // ms
  maxSentences: number;
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): BriefConfig {
  return {
    briefDir: (api.pluginConfig?.briefDir as string) || "memory/brief",
    minDuration: (api.pluginConfig?.minDuration as number) || 30000,
    maxSentences: (api.pluginConfig?.maxSentences as number) || 3,
  };
}

function extractText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(c => extractText(c)).join(" ");
  }
  if (typeof content === "object" && content !== null) {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
    if (typeof c.content === "string") return c.content;
  }
  return "";
}

function generateBrief(
  messages: unknown[],
  cfg: BriefConfig
): string {
  const msgs = messages as Array<{ role?: string; content?: unknown }>;
  const userMsgs = msgs.filter(m => m.role === "user");
  const assistantMsgs = msgs.filter(m => m.role === "assistant");

  if (userMsgs.length === 0) {
    return "用户无输入，会话未开始。";
  }

  // First user message — the task
  const firstTask = extractText(userMsgs[0]?.content).slice(0, 150);

  // Last user message — where they ended up
  const lastUserMsg = userMsgs[userMsgs.length - 1];
  const lastUserText = extractText(lastUserMsg?.content).slice(0, 100);

  // Count what happened
  const toolCallCount = assistantMsgs.filter(m => {
    const content = m.content;
    if (Array.isArray(content)) {
      return content.some((b: unknown) => typeof b === "object" && (b as Record<string, unknown>)?.type === "tool_call");
    }
    return false;
  }).length;

  // Check for success/error indicators
  const lastAssistantText = extractText(assistantMsgs[assistantMsgs.length - 1]?.content);
  const hasError = lastAssistantText.toLowerCase().includes("error") ||
                   lastAssistantText.toLowerCase().includes("failed") ||
                   lastAssistantText.toLowerCase().includes("无法");
  const hasSuccess = lastAssistantText.toLowerCase().includes("完成") ||
                     lastAssistantText.toLowerCase().includes("done") ||
                     lastAssistantText.toLowerCase().includes("success") ||
                     lastAssistantText.toLowerCase().includes("搞定") ||
                     lastAssistantText.toLowerCase().includes("好了");

  // Build 1-3 sentences
  const sentences: string[] = [];

  // Sentence 1: what was the task
  sentences.push(`任务：${firstTask}${firstTask.endsWith("。") ? "" : "。"}`);

  // Sentence 2: what tools were used / what happened
  if (toolCallCount > 0) {
    sentences.push(`使用了 ${toolCallCount} 次工具完成了操作。`);
  } else if (lastUserText && lastUserText !== firstTask) {
    sentences.push(`用户进行了：${lastUserText}${lastUserText.endsWith("。") ? "" : "。"}`);
  }

  // Sentence 3: outcome
  if (hasError) {
    sentences.push("结果：遇到了问题，未完成。");
  } else if (hasSuccess) {
    sentences.push("结果：已完成。");
  } else if (toolCallCount > 0) {
    sentences.push("结果：工具调用完成。");
  }

  return sentences.slice(0, cfg.maxSentences).join(" ");
}

export default definePluginEntry({
  id: "brief-tool",
  name: "Brief Tool",
  description: "Generate 1-3 sentence session summary on agent_end (P0 BriefTool)",
  register(api) {
    api.on("agent_end", async (
      event: PluginHookAgentEndEvent,
      ctx: { sessionKey?: string }
    ) => {
      const cfg = getConfig(api);

      if (event.durationMs && event.durationMs < cfg.minDuration) {
        api.logger.debug(`brief-tool: session too short (${event.durationMs}ms < ${cfg.minDuration}ms), skipping`);
        return undefined;
      }

      try {
        const brief = generateBrief(event.messages, cfg);
        const now = new Date();
        const date = now.toISOString().split("T")[0];
        const time = now.toTimeString().slice(0, 8);
        const sessionId = (ctx.sessionKey || "unknown").split(":").pop() || "unknown";

        const frontmatter = [
          "---",
          `type: brief`,
          `date: ${date}`,
          `time: ${time}`,
          `session: ${sessionId}`,
          `success: ${event.success}`,
          `duration: ${event.durationMs ? Math.round(event.durationMs / 1000) + "s" : "unknown"}`,
          "---",
          "",
        ].join("\n");

        const content = frontmatter + brief + "\n";

        const dir = join(process.cwd(), cfg.briefDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const filename = `${date}.md`;
        const filepath = join(dir, filename);

        // Append to daily brief file
        writeFileSync(filepath, content, { flag: "a" });
        api.logger.info(`brief-tool: wrote brief to ${filepath}: "${brief.slice(0, 60)}..."`);
      } catch (e) {
        api.logger.info(`brief-tool: failed to write brief: ${e}`);
      }

      return undefined;
    });

    api.on("gateway_start", async () => {
      api.logger.info("brief-tool plugin loaded");
      return undefined;
    });

    api.logger.info("brief-tool plugin registered hooks: agent_end");
  },
});
