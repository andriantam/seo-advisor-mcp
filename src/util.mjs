// Shared helpers: result formatting, error handling, tool annotations, date defaults.

export const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

export const fail = (err) => ({ isError: true, content: [{ type: "text", text: String(err?.message || err) }] });

/** Wrap a handler so thrown errors become MCP tool errors instead of crashing the server. */
export const guard = (fn) => async (args) => {
  try {
    return ok(await fn(args ?? {}));
  } catch (err) {
    return fail(err);
  }
};

/** Every tool here only reads data, and reaches out to the internet. */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const iso = (d) => d.toISOString().slice(0, 10);

/** Search Console data lags about 2-3 days, so default the window to end 3 days ago. */
export function defaultRange(days = 28, now = new Date()) {
  const end = new Date(now.getTime() - 3 * 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { startDate: iso(start), endDate: iso(end) };
}
