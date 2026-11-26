import test from "node:test";
import assert from "node:assert/strict";
import { pickAccessibleSite, onSite } from "../src/tools/google.mjs";

test("pickAccessibleSite maps what the user typed to a property the connection can use", () => {
  assert.equal(pickAccessibleSite("https://andriantam.com/", ["sc-domain:andriantam.com"]), "sc-domain:andriantam.com");
  assert.equal(pickAccessibleSite("sc-domain:a.com", ["https://a.com/"]), "https://a.com/");
  assert.equal(pickAccessibleSite("https://a.com/", ["https://www.a.com/"]), "https://www.a.com/");
  assert.equal(pickAccessibleSite("https://blog.a.com/post", ["sc-domain:a.com"]), "sc-domain:a.com");
  assert.equal(pickAccessibleSite("https://a.com/", ["sc-domain:other.com"]), null);
  assert.equal(pickAccessibleSite("https://a.com/", ["https://a.com/", "sc-domain:a.com"]), "https://a.com/"); // exact wins
});

const ctxWith = (accessible, failFor) => {
  const calls = [];
  return {
    calls,
    defaults: {},
    google: () => ({
      email: "bot@x.iam.gserviceaccount.com",
      call: async (url) => {
        calls.push(url);
        if (url.endsWith("/sites")) return { siteEntry: accessible.map((siteUrl) => ({ siteUrl })) };
        if (failFor.some((s) => url.includes(encodeURIComponent(s)))) throw new Error("Google API 403: User does not have sufficient permission for site 'x'.");
        return { rows: [1] };
      },
    }),
  };
};
const run = (ctx) => (s) => ctx.google().call(`https://x/sites/${encodeURIComponent(s)}/q`);

test("onSite retries once on the accessible property after a 403 and says which it used", async () => {
  const ctx = ctxWith(["sc-domain:a.com"], ["https://a.com/"]);
  const out = await onSite(ctx, "https://a.com/", run(ctx));
  assert.equal(out.siteUrlUsed, "sc-domain:a.com");
  assert.deepEqual(out.rows, [1]);
});

test("onSite explains what the connection can see when nothing matches", async () => {
  const ctx = ctxWith(["sc-domain:other.com"], ["https://a.com/"]);
  await assert.rejects(onSite(ctx, "https://a.com/", run(ctx)), /can see: sc-domain:other.com.*bot@x\.iam/s);
});

test("onSite does not touch other errors or successful calls", async () => {
  const ok = ctxWith(["sc-domain:a.com"], []);
  assert.deepEqual(await onSite(ok, "sc-domain:a.com", run(ok)), { rows: [1] });
  assert.equal(ok.calls.length, 1);
  const bad = { defaults: {}, google: () => ({ call: async () => { throw new Error("Google API 500: boom"); } }) };
  await assert.rejects(onSite(bad, "sc-domain:a.com", (s) => bad.google().call(s)), /500: boom/);
});
