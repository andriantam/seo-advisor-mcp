// Fetching URLs that a stranger chose is the classic SSRF risk once this runs as a public server.
// Every outbound request to a user-supplied site goes through here:
//   - http/https only, standard ports only, no credentials in the URL
//   - no localhost, internal-looking names, or private/loopback/link-local/metadata IP addresses
//   - redirects are followed manually (max 5) and every hop is re-checked
//   - a hard timeout and a cap on how many bytes are read
// Limit: a public hostname that DNS-resolves to a private address cannot be seen from here. On Cloudflare
// Workers a subrequest cannot reach private networks anyway; on the local Node build the user is only
// reaching their own machine's network, which they could do without this tool.

export class UnsafeUrlError extends Error {}

const BAD_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet", ".corp"];

function ipv4Parts(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return m ? m.slice(1).map(Number) : null;
}

/** True for IPv4 addresses that are not ordinary public internet addresses. */
export function isPrivateIPv4([a, b, c]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast, reserved, broadcast
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Validate a URL and return it parsed, or throw UnsafeUrlError saying why. */
export function assertPublicUrl(input) {
  let u;
  try {
    u = new URL(String(input));
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("Only http and https URLs are allowed.");
  if (u.username || u.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new UnsafeUrlError("Only the standard web ports (80 and 443) are allowed.");

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("The URL has no host.");
  if (host.startsWith("[") || host.includes(":")) throw new UnsafeUrlError("IPv6 addresses are not allowed; use the site's domain name.");

  const v4 = ipv4Parts(host);
  if (v4) {
    if (v4.some((n) => n > 255) || isPrivateIPv4(v4)) throw new UnsafeUrlError("Private, loopback and reserved addresses are not allowed.");
    return u;
  }
  if (/^[\d.]+$/.test(host) || /^0x/i.test(host)) throw new UnsafeUrlError("That address format is not allowed.");
  if (host === "localhost" || !host.includes(".") || BAD_SUFFIXES.some((s) => host.endsWith(s)))
    throw new UnsafeUrlError("Local and internal host names are not allowed.");
  return u;
}

/** Read a response body as text, stopping after maxBytes. */
async function readCapped(res, maxBytes) {
  if (!res.body) return { text: await res.text(), truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      const keep = value.byteLength - (received - maxBytes);
      text += decoder.decode(value.subarray(0, Math.max(0, keep)), { stream: false });
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text, truncated };
}

/**
 * Fetch a public URL safely. Returns { ok, status, url, headers, text, truncated }.
 * Pass fetchImpl in tests.
 */
export async function safeFetch(url, { fetchImpl = fetch, timeoutMs = 15000, maxBytes = 2_000_000, maxRedirects = 5, headers = {} } = {}) {
  let current = assertPublicUrl(url);
  const deadline = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetchImpl(current.href, { redirect: "manual", signal: deadline, headers });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop === maxRedirects) throw new UnsafeUrlError("Too many redirects.");
      current = assertPublicUrl(new URL(res.headers.get("location"), current).href);
      await res.body?.cancel?.().catch(() => {});
      continue;
    }
    const { text, truncated } = await readCapped(res, maxBytes);
    return { ok: res.ok, status: res.status, url: current.href, headers: res.headers, text, truncated };
  }
  throw new UnsafeUrlError("Too many redirects.");
}
