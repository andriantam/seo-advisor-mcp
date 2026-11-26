// A local folder of article drafts that you review before anything is published. Nothing here publishes
// to a website: each draft is a Markdown file with front matter, so you can edit it and copy it where you publish.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function draftsDir(env = process.env) {
  const dir = env.SEO_DRAFTS_DIR || path.join(os.homedir(), "seo-advisor-drafts");
  if (!path.isAbsolute(dir)) throw new Error("SEO_DRAFTS_DIR must be an absolute path.");
  return dir;
}

/** Letters, numbers and hyphens only, so a slug can never point outside the drafts folder. */
export function safeSlug(input) {
  const slug = String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw new Error("The slug needs at least one letter or number.");
  return slug;
}

const q = (v) => JSON.stringify(String(v ?? ""));

export function renderDraft({ title, targetQuery, publishOn, notes, body, sourceUrl }) {
  const lines = [
    "---",
    `title: ${q(title)}`,
    "status: draft",
    ...(targetQuery ? [`targetQuery: ${q(targetQuery)}`] : []),
    ...(publishOn ? [`publishOn: ${q(publishOn)}`] : []),
    ...(sourceUrl ? [`inspiredBy: ${q(sourceUrl)}`] : []),
    ...(notes ? [`notes: ${q(notes)}`] : []),
    "---",
    "",
    body.trim(),
    "",
  ];
  return lines.join("\n");
}

/** Read the small front-matter block (one `key: value` per line, values JSON-quoted or bare). */
export function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const meta = {};
  if (!m) return meta;
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    try {
      if (val.startsWith('"')) val = JSON.parse(val);
    } catch {
      /* keep the raw text */
    }
    meta[key] = val;
  }
  return meta;
}

/** Save a draft. Refuses to overwrite a file you have already marked as anything other than draft. */
export function saveDraft(input, { dir = draftsDir() } = {}) {
  if (!input.title?.trim()) throw new Error("A title is required.");
  if (!input.body?.trim()) throw new Error("The draft body is empty.");
  const slug = safeSlug(input.slug || input.title);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  if (path.dirname(file) !== path.resolve(dir)) throw new Error("Invalid slug.");
  if (fs.existsSync(file)) {
    const status = parseFrontMatter(fs.readFileSync(file, "utf8")).status;
    if (status && status !== "draft") throw new Error(`${slug}.md already exists with status "${status}". It was not changed.`);
  }
  fs.writeFileSync(file, renderDraft(input), { mode: 0o600 });
  return { file, slug, status: "draft" };
}

/** The calendar: every draft, soonest publishOn first, drafts with no date last. */
export function listDrafts({ dir = draftsDir() } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const meta = parseFrontMatter(text);
      return {
        file: path.join(dir, f),
        slug: f.replace(/\.md$/, ""),
        title: meta.title || f,
        status: meta.status || "draft",
        publishOn: meta.publishOn || null,
        targetQuery: meta.targetQuery || null,
        words: text.replace(/^---[\s\S]*?\n---\n?/, "").split(/\s+/).filter(Boolean).length,
      };
    })
    .sort((a, b) => String(a.publishOn || "9999").localeCompare(String(b.publishOn || "9999")) || a.slug.localeCompare(b.slug));
}
