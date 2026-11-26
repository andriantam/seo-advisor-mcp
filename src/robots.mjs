// Minimal robots.txt matcher (longest-match wins, Allow beats Disallow on a tie, * and $ supported).
// Used so the competitor crawl only reads pages the site's own robots.txt allows.

function groupsFor(text, agent) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && cur) {
      cur.rules.push({ allow: field === "allow", pattern: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x)));
  return (specific.length ? specific : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
}

const toRegex = (pattern) =>
  new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));

/** May `agent` fetch `path` (with query) according to this robots.txt text? An empty or missing file allows everything. */
export function robotsAllows(robotsText, path, agent = "seo-advisor-mcp") {
  let best = null;
  for (const r of groupsFor(robotsText, agent)) {
    if (!r.pattern) continue; // "Disallow:" with no value allows everything
    if (!toRegex(r.pattern).test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
