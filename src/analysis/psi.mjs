// PageSpeed Insights API: runs Lighthouse in Google's cloud (no local Chrome) and adds real-user
// field data from the Chrome UX Report when the site has enough traffic.

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
const LAB = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"];

/** Condense a PSI response into the parts an advisor needs. Exported for tests. */
export function summarisePsi(data, { maxIssues = 12 } = {}) {
  const lh = data.lighthouseResult || {};
  const audits = lh.audits || {};
  const scores = {};
  for (const [id, c] of Object.entries(lh.categories || {})) scores[id] = Math.round((c.score ?? 0) * 100);

  const lab = {};
  for (const id of LAB) if (audits[id]) lab[id] = audits[id].displayValue || null;

  const issues = [];
  for (const c of Object.values(lh.categories || {})) {
    for (const ref of c.auditRefs || []) {
      const a = audits[ref.id];
      if (!a || a.score === null || a.score === undefined || a.score >= 0.9 || !ref.weight) continue;
      issues.push({
        category: c.id,
        id: ref.id,
        title: a.title,
        value: a.displayValue || null,
        score: Math.round(a.score * 100),
        weight: ref.weight,
        savingsMs: a.details?.overallSavingsMs ? Math.round(a.details.overallSavingsMs) : undefined,
      });
    }
  }
  issues.sort((x, y) => y.weight - x.weight || x.score - y.score);

  const field = {};
  for (const [id, m] of Object.entries(data.loadingExperience?.metrics || {})) {
    field[id] = { p75: m.percentile, rating: m.category };
  }

  return {
    url: lh.finalUrl || data.id,
    strategy: lh.configSettings?.formFactor,
    lighthouseVersion: lh.lighthouseVersion,
    scores,
    lab,
    fieldDataAvailable: Object.keys(field).length > 0,
    field,
    topIssues: issues.slice(0, maxIssues),
  };
}

export async function runPsi({ url, strategy = "mobile", apiKey }) {
  const params = new URLSearchParams({ url, strategy });
  for (const c of CATEGORIES) params.append("category", c);
  if (apiKey) params.set("key", apiKey);
  const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(120000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const hint = res.status === 429 ? " (Google's shared anonymous quota is used up. Add your own free PageSpeed API key: in the extension settings or PSI_API_KEY locally, or by reconnecting the connector and filling in the PageSpeed field)" : "";
    throw new Error(`PageSpeed Insights error: ${msg}${hint}`);
  }
  return summarisePsi(data);
}
