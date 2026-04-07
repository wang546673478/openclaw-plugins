# 2026-04-07 Evolution

## Research Updates

### GitHub Findings

- **henrikrexed/openclaw-observability-plugin**  
  https://github.com/henrikrexed/openclaw-observability-plugin  
  Uses typed plugin hooks to capture full agent lifecycle for observability. Good reference architecture.

- **cdot65/prisma-airs-plugin-openclaw** (Palo Alto Networks)  
  https://github.com/cdot65/prisma-airs-plugin-openclaw  
  Comprehensive plugin: 12 hooks, scanner adapter, config resolution, TTL cache, security/DLP/audit. Excellent hook pattern reference.

- **cbuntingde/openclaw-plugins**  
  https://github.com/cbuntingde/openclaw-plugins  
  Community custom plugins for automation/integration.

- **win4r/openclaw-a2a-gateway**  
  https://github.com/win4r/openclaw-a2a-gateway  
  A2A protocol gateway plugin for agent-to-agent communication.

- **rjdjohnston/clawcipes** (ClawRecipes)  
  https://github.com/rjdjohnston/clawcipes  
  OpenClaw plugin for scaffolding agents/teams from Markdown recipes.

- **snarktank/antfarm**  
  https://github.com/snarktank/antfarm  
  Agent team builder for OpenClaw — define team of specialized agents in one command.

- **sundial-org/awesome-openclaw-skills** (554 stars)  
  https://github.com/sundial-org/awesome-openclaw-skills  
  Curated skills list with self-improving-agent, code-explainer, cli-developer, cron-gen.

- **VoltAgent/awesome-openclaw-skills** (44.6k stars)  
  https://github.com/VoltAgent/awesome-openclaw-skills  
  Largest OpenClaw skills collection — 519 skills across security, coding, gaming, productivity.

## Plugin Implemented

### context-stats (NEW — 257 lines)

**What**: Tracks message counts, token estimates, and tool call stats across the agent lifecycle. Writes per-session JSON snapshots to `memory/stats/` plus a `_summary.json`.

**Hooks used (10 total)**:
- session_start / session_end
- before_prompt_build
- after_tool_call
- agent_end
- before_compaction / after_compaction
- subagent_spawning / subagent_ended
- gateway_stop

**Token estimation**: ~4 chars/token for English, ~2 for CJK, with block-level content parsing.

**Output files**:
- `memory/stats/<sessionKey>.json` — per-session snapshot with full event log
- `memory/stats/_summary.json` — all sessions overview

**对应任务**: P2 Hooks 完整版覆盖 / P5 Observability

**Status**: ✅ Implemented 2026-04-07

## Git Commit

```
plugin: add context-stats — lifecycle token/stats tracking to memory/stats/
```

## Notes

- Prisma AIRS plugin hook patterns (12 hooks, scanner adapter, TTL cache) are good future reference for security-oriented plugins.
- Observability plugin confirms typed hook approach is the right pattern.
- Next opportunity: `compact-warning` (early warning before compaction threshold) or PostPromptBuild hook addition to agent-hooks.
