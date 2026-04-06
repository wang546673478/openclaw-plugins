/**
 * Skill Invoker Plugin
 *
 * Registers a `skill` tool that forces skill invocation.
 * This enforces using-superpowers: "If a skill applies, you MUST invoke it."
 *
 * The skill tool:
 * - Takes a skill name
 * - Reads the SKILL.md from the skill directory
 * - Returns the content for the AI to follow
 *
 * Enforcement mechanism:
 * - Skills are NOT in the system prompt by default (only skill NAMES are listed)
 * - To actually USE a skill, the AI MUST call the `skill` tool
 * - This makes skill usage explicit and enforceable
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

interface SkillConfig {
  skillDir: string;
}

function getConfig(api: { pluginConfig: Record<string, unknown>; pluginId?: string }): SkillConfig {
  // skillDir is relative to workspace (cwd)
  const pluginSkillDir = api.pluginConfig?.skillDir as string;
  return {
    skillDir: pluginSkillDir || "skills",
  };
}

function listSkills(skillDir: string): Array<{ name: string; description: string }> {
  const skills: Array<{ name: string; description: string }> = [];
  try {
    const entries = readdirSync(skillDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skildMdPath = join(skillDir, entry.name, "SKILL.md");
      if (!existsSync(skildMdPath)) continue;

      try {
        const content = readFileSync(skildMdPath, "utf-8");
        // Extract name and description from frontmatter
        const nameMatch = content.match(/^---\s*\nname:\s*(.+?)\s*\n/m);
        const descMatch = content.match(/^---\s*\n(?:name:.+\n)?description:\s*(.+?)\s*\n/m);
        const name = nameMatch ? nameMatch[1].trim() : entry.name;
        const description = descMatch ? descMatch[1].trim() : "";
        skills.push({ name, description });
      } catch {}
    }
  } catch {}
  return skills;
}

function invokeSkill(skillDir: string, skillName: string): string {
  // Try exact match first
  const skillPath = join(skillDir, skillName, "SKILL.md");
  if (existsSync(skillPath)) {
    return readFileSync(skillPath, "utf-8");
  }

  // Try case-insensitive match
  try {
    const entries = readdirSync(skillDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.toLowerCase() === skillName.toLowerCase()) {
        const path = join(skillDir, entry.name, "SKILL.md");
        if (existsSync(path)) {
          return readFileSync(path, "utf-8");
        }
      }
    }
  } catch {}

  return `Skill "${skillName}" not found. Available skills: ${listSkills(skillDir).map(s => s.name).join(", ") || "(none)"}`;
}

export default definePluginEntry({
  id: "skill-invoker",
  name: "Skill Invoker",
  description: "Skill tool for forced skill invocation (using-superpowers enforcement)",
  register(api) {
    const cfg = getConfig(api);

    // ── skill tool ────────────────────────────────────────────────────────
    // The core enforcement mechanism: AI MUST call this tool to get skill content
    api.registerTool({
      name: "skill",
      description: "Invoke a skill by name. MUST be called before taking any action if a relevant skill exists. Returns the full skill content to follow.",
      parameters: {},
      async execute(_id, params: { name?: string; list?: boolean }) {
        const skillDir = cfg.skillDir;

        // List all available skills
        if (params?.list) {
          const skills = listSkills(skillDir);
          if (skills.length === 0) {
            return { content: [{ type: "text", text: "No skills found." }] };
          }
          const lines = ["## Available Skills\n"];
          for (const s of skills) {
            lines.push(`- **${s.name}**: ${s.description}`);
          }
          lines.push("\nUse `skill({ name: \"<skill-name>\" })` to invoke a skill.");
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        // Invoke specific skill
        const skillName = params?.name;
        if (!skillName) {
          const skills = listSkills(skillDir);
          return {
            content: [{
              type: "text",
              text: `Skill name required. Available: ${skills.map(s => s.name).join(", ") || "(none)"}`,
            }],
          };
        }

        const content = invokeSkill(skillDir, skillName);
        api.logger.info(`skill-invoker: invoked skill "${skillName}" (found=${!content.includes("not found")})`);

        return {
          content: [{
            type: "text",
            text: content,
          }],
        };
      },
    }, { optional: true });

    api.on("gateway_start", async () => {
      const skills = listSkills(cfg.skillDir);
      api.logger.info(`skill-invoker loaded — available skills: ${skills.map(s => s.name).join(", ")}`);
      return undefined;
    });

    api.logger.info("skill-invoker registered tool: skill");
  },
});
