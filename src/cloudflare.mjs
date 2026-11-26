// Cloudflare API client (read-only). Optional: only used when a Cloudflare API token is configured.
//   Radar ranking (any domain, public data):  GET  /client/v4/radar/ranking/domain/{domain}
//   Zone traffic (sites on your Cloudflare):   POST /client/v4/graphql  (GraphQL Analytics API)
// The token is sent only in the Authorization header and is never included in an error message.

const API = "https://api.cloudflare.com/client/v4";

export const CF_NOT_SET_UP = "Cloudflare is not set up for this connection. Add a Cloudflare API token (and, for your own site's traffic, the zone ID) when you connect, or set CLOUDFLARE_API_TOKEN locally.";

function hintFor(status) {
  if (status === 401 || status === 403) return "Check that the API token is active and has the permission this tool needs.";
  if (status === 429) return "Cloudflare is rate-limiting this token. Wait a few minutes and try again.";
  if (status >= 500) return "Cloudflare had a server error. Try again later.";
  return "";
}

async function request(url, { method = "GET", body, token, fetchImpl = fetch, timeoutMs = 20000 }) {
  if (!token) throw new Error(CF_NOT_SET_UP);
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      body,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Do not include the URL or the error details: keep the token out of messages.
    throw new Error("Could not reach the Cloudflare API. Check the network and try again.");
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok || json?.success === false) {
    const msg = json?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API error: ${msg}. ${hintFor(res.status)}`.trim());
  }
  return json ?? {};
}

/** GET a Radar REST path, e.g. "/radar/ranking/domain/example.com". Returns the unwrapped result. */
export async function cfRadar(path, opts) {
  const json = await request(`${API}${path}`, opts);
  return json.result ?? {};
}

/** Run a GraphQL Analytics query. Returns the `data` node. */
export async function cfGraphql(query, variables, opts) {
  const json = await request(`${API}/graphql`, { ...opts, method: "POST", body: JSON.stringify({ query, variables }) });
  if (json.errors?.length) throw new Error(`Cloudflare Analytics error: ${json.errors[0].message}`);
  return json.data ?? {};
}

/** Check that a token is active. Does not prove it has analytics permission. */
export async function cfVerifyToken(opts) {
  const json = await request(`${API}/user/tokens/verify`, opts);
  return json.result?.status ?? "active";
}
