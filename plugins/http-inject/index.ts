/**
 * HTTP Inject Plugin (KAIROS Core)
 *
 * Receives external HTTP webhooks and injects them as events into agent sessions.
 *
 * Architecture:
 * 1. HTTP route receives external events (webhooks from any source)
 * 2. Events are queued in memory (plugin runtime store)
 * 3. session_start or before_agent_reply injects pending events as prependContext
 * 4. Subagent processes the event and optionally responds via Feishu
 *
 * This is the KAIROS "external events trigger AI response" pattern.
 *
 * External events flow:
 * Any system → HTTP POST /kairos/event → queue → agent context → response
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type {
  PluginHookSessionStartEvent,
  PluginHookBeforeAgentReplyEvent,
} from "openclaw/plugin-sdk/plugins/types.js";

interface KairosEvent {
  id: string;
  source: string;
  type: string;
  payload: unknown;
  timestamp: string;
  sessionKey?: string;
  processed: boolean;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default definePluginEntry({
  id: "http-inject",
  name: "HTTP Inject (KAIROS)",
  description: "Receive HTTP webhooks and inject external events into agent sessions (KAIROS Core)",
  register(api) {
    // Runtime store for event queue
    const store = createPluginRuntimeStore<KairosEvent[]>("kairos-events", []);
    const cfg = api.pluginConfig as { port?: number; sessionKey?: string };

    // ── HTTP Route: receive external events ──────────────────────────────
    api.registerHttpRoute({
      path: "/kairos/event",
      auth: "plugin", // plugin-managed auth
      match: "prefix",
      handler: async (req, res) => {
        try {
          // Only accept POST
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return true;
          }

          // Parse body
          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }

          let event: Partial<KairosEvent>;
          try {
            event = JSON.parse(body);
          } catch {
            res.statusCode = 400;
            res.end("Invalid JSON");
            return true;
          }

          // Validate required fields
          if (!event.type || !event.payload) {
            res.statusCode = 400;
            res.end("Missing type or payload");
            return true;
          }

          // Create full event
          const kairosEvent: KairosEvent = {
            id: generateId(),
            source: event.source || "http",
            type: event.type as string,
            payload: event.payload,
            timestamp: new Date().toISOString(),
            sessionKey: event.sessionKey || cfg.sessionKey,
            processed: false,
          };

          // Queue event
          const events = store.get() ?? [];
          events.push(kairosEvent);
          store.set(events);

          api.logger.info(`http-inject: received ${kairosEvent.type} event from ${kairosEvent.source}, queued (total=${events.length})`);

          // Acknowledge receipt
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, eventId: kairosEvent.id }));
          return true;
        } catch (e) {
          api.logger.info(`http-inject: error handling request: ${e}`);
          res.statusCode = 500;
          res.end("Internal Error");
          return true;
        }
      },
    });

    // ── HTTP Route: list pending events ─────────────────────────────────
    api.registerHttpRoute({
      path: "/kairos/events",
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return true;
        }

        const events = store.get() ?? [];
        const pending = events.filter(e => !e.processed);

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ pending: pending.length, events: pending }));
        return true;
      },
    });

    // ── HTTP Route: clear/acknowledge events ────────────────────────────
    api.registerHttpRoute({
      path: "/kairos/ack",
      auth: "plugin",
      match: "prefix",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return true;
        }

        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }

        let ids: string[] = [];
        try {
          const parsed = JSON.parse(body);
          ids = parsed.ids ?? [];
        } catch {
          res.statusCode = 400;
          res.end("Invalid JSON");
          return true;
        }

        const events = store.get() ?? [];
        const remaining = events.filter(e => !ids.includes(e.id));
        store.set(remaining);

        api.logger.info(`http-inject: acknowledged ${ids.length} events (remaining=${remaining.length})`);

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, acknowledged: ids.length, remaining: remaining.length }));
        return true;
      },
    });

    // ── session_start: inject pending events ───────────────────────────
    api.on("session_start", async (
      event: PluginHookSessionStartEvent,
      ctx: { sessionKey?: string }
    ) => {
      const events = store.get() ?? [];
      const pending = events.filter(e => !e.processed);

      if (pending.length === 0) return undefined;

      // Filter to events for this session (or no specific session = broadcast)
      const myEvents = pending.filter(e => !e.sessionKey || e.sessionKey === ctx.sessionKey);
      if (myEvents.length === 0) return undefined;

      // Mark as processed (will be cleared by /kairos/ack)
      for (const e of myEvents) {
        e.processed = true;
      }
      store.set(events);

      // Inject as prependContext
      const lines = myEvents.map(e =>
        `【外部事件 ${e.type}】来源：${e.source} | ${JSON.stringify(e.payload)}`
      );
      const inject = `【KAIROS 事件提醒】检测到 ${myEvents.length} 个待处理外部事件：\n${lines.join("\n")}\n\n`;

      api.logger.info(`http-inject: injected ${myEvents.length} events into session ${ctx.sessionKey}`);
      return { prependContext: inject };
    });

    // ── before_agent_reply: inject pending events (for active sessions) ─
    // This fires on every turn, so we inject events into the next prompt
    api.on("before_agent_reply", async (
      event: PluginHookBeforeAgentReplyEvent,
      ctx: { sessionKey?: string }
    ) => {
      const events = store.get() ?? [];
      const pending = events.filter(e => !e.processed && (!e.sessionKey || e.sessionKey === ctx.sessionKey));

      if (pending.length === 0) return undefined;

      // Mark as processed
      for (const e of pending) {
        e.processed = true;
      }
      store.set(events);

      const lines = pending.map(e =>
        `【外部事件 ${e.type}】来源：${e.source} | ${JSON.stringify(e.payload)}`
      );
      const inject = `【KAIROS 事件】${pending.length} 个待处理：\n${lines.join("\n")}\n\n`;

      api.logger.info(`http-inject: before_agent_reply injected ${pending.length} events`);
      return { prependContext: inject };
    });

    api.on("gateway_start", async () => {
      api.logger.info("http-inject (KAIROS) plugin loaded — webhook endpoint: /kairos/event");
      return undefined;
    });

    api.logger.info("http-inject (KAIROS) plugin registered: /kairos/event route + session_start + before_agent_reply hooks");
  },
});
