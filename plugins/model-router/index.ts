/**
 * Model Router Plugin
 *
 * Implements before_model_resolve hook to route prompts to different
 * models/providers based on keyword matching rules.
 *
 * Maps to P0 1.6 Tool Search / model selection intelligence.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookBeforeModelResolveEvent,
  PluginHookBeforeModelResolveResult,
} from "openclaw/plugin-sdk/plugins/types.js";

interface RoutingRule {
  keywords: string[];
  model: string;
  provider?: string;
}

interface ModelRouterConfig {
  enabled: boolean;
  logLevel: "debug" | "info" | "warn";
  defaultModel?: string;
  defaultProvider?: string;
  rules: RoutingRule[];
}

function getConfig(api: { pluginConfig: Record<string, unknown> }): ModelRouterConfig {
  const cfg = api.pluginConfig ?? {};
  return {
    enabled: cfg.enabled !== false,
    logLevel: (cfg.logLevel as ModelRouterConfig["logLevel"]) || "info",
    defaultModel: cfg.defaultModel as string | undefined,
    defaultProvider: cfg.defaultProvider as string | undefined,
    rules: (cfg.rules as RoutingRule[]) || [],
  };
}

function matchRule(prompt: string, rule: RoutingRule): boolean {
  const lower = prompt.toLowerCase();
  return rule.keywords.some(kw => lower.includes(kw.toLowerCase()));
}

function resolveModel(
  prompt: string,
  cfg: ModelRouterConfig
): PluginHookBeforeModelResolveResult {
  // Evaluate rules in order; first match wins
  for (const rule of cfg.rules) {
    if (matchRule(prompt, rule)) {
      const result: PluginHookBeforeModelResolveResult = {
        modelOverride: rule.model,
      };
      if (rule.provider) {
        result.providerOverride = rule.provider;
      }
      return result;
    }
  }

  // No rule matched — use defaults if set
  if (cfg.defaultModel || cfg.defaultProvider) {
    return {
      modelOverride: cfg.defaultModel,
      providerOverride: cfg.defaultProvider,
    };
  }

  return {};
}

export default definePluginEntry({
  id: "model-router",
  name: "Model Router",
  description: "Route prompts to different models/providers via before_model_resolve hook",
  register(api) {
    const cfg = getConfig(api);

    if (!cfg.enabled) {
      api.logger.info("model-router: disabled, skipping");
      return;
    }

    api.on("before_model_resolve", async (
      event: PluginHookBeforeModelResolveEvent,
      _ctx: { sessionKey?: string }
    ): Promise<PluginHookBeforeModelResolveResult | void> => {
      const result = resolveModel(event.prompt, cfg);

      if (result.modelOverride || result.providerOverride) {
        api.logger.info(
          `model-router: prompt="${event.prompt.slice(0, 80)}..." → ` +
          `model=${result.modelOverride ?? "(unchanged)"} provider=${result.providerOverride ?? "(unchanged)"}`
        );
      } else {
        api.logger.debug(`model-router: no rules matched, passthrough`);
      }

      return result;
    });

    api.logger.info(
      `model-router plugin registered: before_model_resolve (${cfg.rules.length} rules)`
    );
  },
});
