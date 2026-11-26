// Anonymous usage counts. Off unless the operator sets ANALYTICS=on.
//
// Designed so the project works with or without Cloudflare:
//   - ANALYTICS=off (the default) records nothing, whatever else is configured.
//   - The Cloudflare sink needs the ANALYTICS_ENGINE binding. Without it, counting is off.
//   - Any other host can supply its own sink (see createAnalytics) or leave counting off.
//
// Data minimisation: only whitelisted fields are kept, a connection ID is hashed with a secret
// (ANALYTICS_SECRET) before it is stored, and tool inputs, results, keys, site addresses and queries
// are never passed in, so they cannot be recorded.

const EVENTS = new Set(["connection_created", "tool_call"]);
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const COUNTRY = /^[A-Z]{2}$/;

/** True only when the operator has explicitly switched counting on. */
export function analyticsEnabled(env = {}) {
  return String(env.ANALYTICS ?? "off").trim().toLowerCase() === "on";
}

/** HMAC-SHA256 of a connection ID, hex. Stable for one secret, unlinkable without it. */
export async function hashId(id, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(id)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keep only known, well-formed fields. Anything else is dropped before it reaches a sink. */
export function sanitize(input = {}) {
  if (!EVENTS.has(input.event)) return null;
  const tool = typeof input.tool === "string" && TOOL_NAME.test(input.tool) ? input.tool : "";
  const outcome = input.outcome === "error" ? "error" : input.outcome === "ok" ? "ok" : "";
  const errorKind = typeof input.errorKind === "string" ? input.errorKind.replace(/[^a-z_]/g, "").slice(0, 32) : "";
  const country = typeof input.country === "string" && COUNTRY.test(input.country) ? input.country : "";
  const durationMs = Number.isFinite(input.durationMs) && input.durationMs >= 0 ? Math.round(input.durationMs) : 0;
  return { event: input.event, tool, outcome, errorKind, country, durationMs };
}

/**
 * Build a tracker. `sink` receives { blobs, doubles, indexes } per event.
 * Returns a no-op tracker when counting is off or there is no sink, so callers never need to check.
 */
export function createAnalytics({ enabled, secret, sink }) {
  if (!enabled || !sink) return { enabled: false, track: async () => {} };
  if (!secret || secret.length < 16) throw new Error("Usage counts need ANALYTICS_SECRET (at least 16 characters) to hash connection IDs.");
  return {
    enabled: true,
    async track(input) {
      const f = sanitize(input);
      if (!f) return;
      const indexes = input.connectionId ? [await hashId(input.connectionId, secret)] : [];
      await sink({
        blobs: [f.event, f.tool, f.outcome, f.errorKind, f.country],
        doubles: [f.durationMs, 1],
        indexes,
      });
    },
  };
}

/** Cloudflare Workers Analytics Engine, via the ANALYTICS_ENGINE binding in wrangler.jsonc. */
export function analyticsEngineSink(binding) {
  return (point) => binding.writeDataPoint(point);
}

/** The tracker for a Worker request. Misconfiguration turns counting off rather than failing the service. */
export function analyticsFor(env = {}) {
  try {
    return createAnalytics({
      enabled: analyticsEnabled(env),
      secret: env.ANALYTICS_SECRET,
      sink: env.ANALYTICS_ENGINE ? analyticsEngineSink(env.ANALYTICS_ENGINE) : null,
    });
  } catch (err) {
    console.warn(`Usage counts are off: ${err.message}`);
    return createAnalytics({ enabled: false });
  }
}
