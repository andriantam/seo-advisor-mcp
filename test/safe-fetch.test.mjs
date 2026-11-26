import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl, safeFetch, UnsafeUrlError } from "../src/safe-fetch.mjs";

const blocked = [
  "http://localhost/", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.1/",
  "http://169.254.169.254/latest/meta-data/", "http://0.0.0.0/", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
  "http://2130706433/", "http://0x7f.1/", "http://intranet/", "http://foo.internal/", "http://printer.local/",
  "ftp://example.com/", "file:///etc/passwd", "https://user:pw@example.com/", "https://example.com:8080/", "http://100.64.0.1/",
];
for (const u of blocked) test(`blocks ${u}`, () => assert.throws(() => assertPublicUrl(u), UnsafeUrlError));

test("allows normal public sites", () => {
  for (const u of ["https://example.com/", "http://sub.example.co.uk/path?q=1", "https://8.8.8.8/", "https://example.com:443/"]) assert.doesNotThrow(() => assertPublicUrl(u));
});

const res = (status, body = "", headers = {}) => new Response(body, { status, headers });

test("follows redirects but re-checks every hop", async () => {
  const fetchImpl = async (url) => (url.startsWith("https://a.com") ? res(302, "", { location: "http://169.254.169.254/" }) : res(200, "secret"));
  await assert.rejects(safeFetch("https://a.com/", { fetchImpl }), UnsafeUrlError);
});

test("follows a safe redirect and returns the body", async () => {
  const fetchImpl = async (url) => (url === "https://a.com/" ? res(301, "", { location: "/b" }) : res(200, "hello"));
  const r = await safeFetch("https://a.com/", { fetchImpl });
  assert.equal(r.text, "hello");
  assert.equal(r.url, "https://a.com/b");
});

test("stops redirect loops", async () => {
  const fetchImpl = async () => res(302, "", { location: "https://a.com/" });
  await assert.rejects(safeFetch("https://a.com/", { fetchImpl, maxRedirects: 3 }), /Too many redirects/);
});

test("caps the response size", async () => {
  const fetchImpl = async () => res(200, "x".repeat(10_000));
  const r = await safeFetch("https://a.com/", { fetchImpl, maxBytes: 1000 });
  assert.equal(r.text.length, 1000);
  assert.equal(r.truncated, true);
});
