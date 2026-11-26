import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeSlug, saveDraft, listDrafts, parseFrontMatter, draftsDir } from "../src/analysis/drafts.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "drafts-"));

test("safeSlug strips path tricks", () => {
  assert.equal(safeSlug("../../etc/passwd"), "etc-passwd");
  assert.equal(safeSlug("How to Change a Fog Lamp!"), "how-to-change-a-fog-lamp");
  assert.throws(() => safeSlug("///"), /at least one/);
});

test("saves a draft and lists it as a calendar", () => {
  const dir = tmp();
  saveDraft({ title: "Later", body: "Body", publishOn: "2026-12-10" }, { dir });
  const r = saveDraft({ title: "Sooner: a \"quoted\" title", body: "Hello world", publishOn: "2026-12-01", targetQuery: "fog lamp" }, { dir });
  assert.equal(r.status, "draft");
  const list = listDrafts({ dir });
  assert.deepEqual(list.map((d) => d.publishOn), ["2026-12-01", "2026-12-10"]);
  assert.equal(list[0].title, 'Sooner: a "quoted" title');
  assert.equal(list[0].targetQuery, "fog lamp");
  assert.equal(parseFrontMatter(fs.readFileSync(r.file, "utf8")).status, "draft");
});

test("will not overwrite a draft that has been approved", () => {
  const dir = tmp();
  const r = saveDraft({ title: "One", body: "x" }, { dir });
  fs.writeFileSync(r.file, fs.readFileSync(r.file, "utf8").replace("status: draft", "status: approved"));
  assert.throws(() => saveDraft({ title: "One", body: "y" }, { dir }), /status "approved"/);
  saveDraft({ title: "Two", body: "x" }, { dir });
  saveDraft({ title: "Two", body: "newer" }, { dir }); // still a draft: allowed
});

test("requires a title and a body, and an absolute drafts folder", () => {
  assert.throws(() => saveDraft({ title: "", body: "x" }, { dir: tmp() }), /title/);
  assert.throws(() => saveDraft({ title: "t", body: " " }, { dir: tmp() }), /empty/);
  assert.throws(() => draftsDir({ SEO_DRAFTS_DIR: "relative/dir" }), /absolute/);
});
