// Public / Bring-Your-Own-Key (BYOK) authentication for non-OAuth MCP agents (e.g. Gemini, Antigravity).
// Runs alongside Claude's OAuth 2.1 flow:
// - Requests to /mcp with X-Client: gemini or BYOK headers run directly with no password gate.
// - Each caller brings their own credentials via headers (or uses the no-login tools) and is rate-limited per IP.
// - Standard /mcp requests without these headers fall through to Claude's OAuthProvider.

export function getPublicMcpAuth(request) {
  const hasAgentHeader =
    request.headers.get("x-client") === "gemini" ||
    request.headers.has("x-google-key") ||
    request.headers.has("x-psi-key") ||
    request.headers.has("x-bing-key");

  if (!hasAgentHeader) return null;

  let google = request.headers.get("x-google-key") || "";
  if (google && google.trim().startsWith("ey") && !google.trim().startsWith("{")) {
    try { google = atob(google); } catch {}
  }

  const ip = request.headers.get("cf-connecting-ip") || "anon";

  return {
    props: {
      userId: `public:${ip}`,
      google,
      psiKey: request.headers.get("x-psi-key") || "",
      bingKey: request.headers.get("x-bing-key") || "",
    },
  };
}
