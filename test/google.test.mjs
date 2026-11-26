import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { createGoogleClient, parseServiceAccount } from "../src/google.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const sa = { type: "service_account", client_email: "bot@proj.iam.gserviceaccount.com", private_key: pem, project_id: "proj" };

test("parseServiceAccount rejects junk without echoing it", () => {
  assert.throws(() => parseServiceAccount("nope"), /not valid JSON/);
  assert.throws(() => parseServiceAccount({ type: "user" }), /not a service-account key/);
});

test("signs a valid RS256 JWT, caches the token, and calls the API with it", async () => {
  let tokenCalls = 0;
  const seen = [];
  const fetchImpl = async (url, opts) => {
    if (url === "https://oauth2.googleapis.com/token") {
      tokenCalls++;
      const jwt = new URLSearchParams(opts.body).get("assertion");
      const [h, c, sig] = jwt.split(".");
      const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"));
      assert.ok(ok, "signature verifies");
      assert.equal(JSON.parse(Buffer.from(c, "base64url")).iss, sa.client_email);
      return Response.json({ access_token: "tok", expires_in: 3600 });
    }
    seen.push(opts.headers.authorization);
    return Response.json({ ok: true });
  };
  const g = createGoogleClient(sa, { fetchImpl });
  assert.deepEqual(await g.call("https://x/api"), { ok: true });
  await g.call("https://x/api");
  assert.equal(tokenCalls, 1);
  assert.deepEqual(seen, ["Bearer tok", "Bearer tok"]);
});

test("API errors are readable and never include the key", async () => {
  const fetchImpl = async (url) => (url.includes("oauth2") ? Response.json({ access_token: "t", expires_in: 3600 }) : Response.json({ error: { message: "forbidden" } }, { status: 403 }));
  const g = createGoogleClient(sa, { fetchImpl });
  await assert.rejects(g.call("https://x/api"), (e) => /Google API 403: forbidden/.test(e.message) && !e.message.includes("PRIVATE KEY"));
});

test("a key that was parsed, stored as JSON and reloaded still works (what the hosted connect page does)", () => {
  const stored = JSON.stringify(parseServiceAccount(JSON.stringify(sa)));
  assert.doesNotThrow(() => createGoogleClient(stored));
  assert.doesNotThrow(() => createGoogleClient(JSON.stringify({ client_email: sa.client_email, private_key: pem }))); // keys stored before the fix lack "type"
  assert.throws(() => parseServiceAccount({ type: "authorized_user", client_email: "x", private_key: "y" }), /not a service-account key/);
});
