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
import { join } from "node:path";

function getSkillsDirs(): string[] {
  const home = process.env.HOME || "/home/hhhh";
  return [
    join(process.cwd(), "skills"),
    join(home, ".openclaw", "workspace", "skills"),
    join(home, ".openclaw", "skills"),
    join(home, ".npm-global", "lib", "node_modules", "openclaw", "skills"),
  ];
}

function listSkills(): Array<{ name: string; description: string }> {
  const seen = new Set<string>();
  const skills: Array<{ name: string; description: string }> = [];
  for (const dir of getSkillsDirs()) {
    try {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);
        const skillMdPath = join(dir, entry.name, "SKILL.md");
        if (!existsSync(skillMdPath)) continue;
        try {
          const content = readFileSync(skillMdPath, "utf-8");
          const nameMatch = content.match(/^---\s*\nname:\s*(.+?)\s*\n/m);
          const descMatch = content.match(/^---\s*\n(?:name:.+\n)?description:\s*(.+?)\s*\n/m);
          const name = nameMatch ? nameMatch[1].trim() : entry.name;
          const description = descMatch ? descMatch[1].trim() : "";
          skills.push({ name, description });
        } catch {}
      }
    } catch {}
  }
  return skills;
}

function invokeSkill(skillName: string): string {
  for (const dir of getSkillsDirs()) {
    try {
      if (!existsSync(dir)) continue;
      const skillPath = join(dir, skillName, "SKILL.md");
      if (existsSync(skillPath)) {
        return readFileSync(skillPath, "utf-8");
      }
      // Case-insensitive match
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.toLowerCase() === skillName.toLowerCase()) {
          const path = join(dir, entry.name, "SKILL.md");
          if (existsSync(path)) return readFileSync(path, "utf-8");
        }
      }
    } catch {}
  }
  const available = listSkills().map(s => s.name).join(", ") || "(none)";
  return `Skill "${skillName}" not found. Available: ${available}`;
}

export default definePluginEntry({
  id: "skill-invoker",
  name: "Skill Invoker",
  description: "Skill tool for forced skill invocation (using-superpowers enforcement)",
  register(api) {
    // ── skill tool ────────────────────────────────────────────────────────
    api.registerTool({
      name: "skill",
      description: "Invoke a skill by name. MUST be called before taking any action if a relevant skill exists. Returns the full skill content to follow.",
      parameters: {},
      async execute(_id, params: { name?: string; list?: boolean }) {
        if (params?.list) {
          const skills = listSkills();
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

        const skillName = params?.name;
        if (!skillName) {
          const skills = listSkills();
          return { content: [{ type: "text", text: `Skill name required. Available: ${skills.map(s => s.name).join(", ") || "(none)"}` }] };
        }

        const content = invokeSkill(skillName);
        api.logger.info(`skill-invoker: invoked "${skillName}" (found=${!content.includes("not found")})`);
        return { content: [{ type: "text", text: content }] };
      },
    }, { optional: true });

    api.on("gateway_start", async () => {
      const skills = listSkills();
      api.logger.info(`skill-invoker loaded — available skills: ${skills.map(s => s.name).join(", ") || "(none)"}`);
      return undefined;
    });

    api.logger.info("skill-invoker registered tool: skill");
  },
});
