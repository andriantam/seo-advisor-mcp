// Google API access with a service-account key, using only fetch and WebCrypto so the same code runs
// on Node 20+ and on Cloudflare Workers. Scopes are read-only. The private key is never logged or
// included in an error message.

const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
].join(" ");
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const b64url = (input) => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToDer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Parse and sanity-check a service-account key (object or JSON text). Never echoes the key. */
export function parseServiceAccount(input) {
  let key = input;
  if (typeof input === "string") {
    try {
      key = JSON.parse(input);
    } catch {
      throw new Error("The Google key is not valid JSON. Paste the whole contents of the service-account .json file.");
    }
  }
  // `type` may be absent in keys this server stored itself (it keeps only the fields it needs), but if present it must be right.
  if (!key || (key.type !== undefined && key.type !== "service_account") || !key.client_email || !key.private_key)
    throw new Error("That is not a service-account key. It must be the JSON file with type 'service_account', a client_email and a private_key.");
  return { type: "service_account", client_email: key.client_email, private_key: key.private_key, project_id: key.project_id };
}

async function signJwt(key, now) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: key.client_email, scope: SCOPES, aud: TOKEN_URL, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 }),
  );
  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey("pkcs8", pemToDer(key.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new Error("The private key in the Google service-account file could not be read. Download a fresh key from Google Cloud.");
  }
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** A client bound to one service account. Caches its access token until shortly before it expires. */
export function createGoogleClient(serviceAccount, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const key = parseServiceAccount(serviceAccount);
  let token = null;
  let expiresAt = 0;

  async function accessToken() {
    if (token && now() < expiresAt - 60_000) return token;
    const jwt = await signJwt(key, now());
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`Google sign-in with the service account failed: ${data.error_description || data.error || `HTTP ${res.status}`}`);
    token = data.access_token;
    expiresAt = now() + (data.expires_in ?? 3600) * 1000;
    return token;
  }

  return {
    email: key.client_email,
    async call(url, { method = "GET", body } = {}) {
      const res = await fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Google API ${res.status}: ${data?.error?.message || res.statusText || "error"}`);
      return data;
    },
  };
}
