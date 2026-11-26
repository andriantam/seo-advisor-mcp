// Claude Desktop passes optional MCPB settings that the user left blank as the literal
// text "${user_config.<name>}" (or as an empty string). Treat both as "not set" so the
// rest of the code can use plain "is it defined?" checks.

export function cleanEnv(env = process.env) {
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t === "" || /^\$\{user_config\.[^}]*\}$/.test(t)) delete env[k];
  }
  return env;
}
