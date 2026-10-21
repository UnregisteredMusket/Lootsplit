import test from "node:test";
import assert from "node:assert/strict";
import { verifyTelemetryToken } from "../cloudflare/monitor-telemetry.mjs";
const encoded = (value) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
test("workflow ingestion verifies real RSA signature, owner/repository IDs, main ref, audience and expiry", async () => {
  const key = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", key.publicKey)),
    kid: "test-key",
    use: "sig",
  };
  const now = Date.now(),
    base = {
      iss: "https://token.actions.githubusercontent.com",
      aud: "https://lootsplit.oliverstorie2017.workers.dev/monitoring",
      repository: "UnregisteredMusket/Lootsplit",
      repository_id: "1398794793",
      repository_owner_id: "336285553",
      ref: "refs/heads/main",
      sub: "repo:UnregisteredMusket/Lootsplit:ref:refs/heads/main",
      workflow_ref: "UnregisteredMusket/Lootsplit/.github/workflows/verify.yml@refs/heads/main",
      event_name: "push",
      run_id: "100",
      run_attempt: "1",
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 300,
    };
  const sign = async (claims) => {
    const payload = `${encoded({ alg: "RS256", typ: "JWT", kid: "test-key" })}.${encoded(claims)}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key.privateKey,
      new TextEncoder().encode(payload),
    );
    return `${payload}.${Buffer.from(signature).toString("base64url")}`;
  };
  const env = { DB: {} },
    fetcher = async (url) => {
      assert.equal(url, "https://token.actions.githubusercontent.com/.well-known/jwks");
      return Response.json({ keys: [jwk] });
    };
  assert.equal((await verifyTelemetryToken(await sign(base), env, now, fetcher)).run_id, "100");
  const immutable = "repo:UnregisteredMusket@336285553/Lootsplit@1398794793";
  assert.equal(
    (
      await verifyTelemetryToken(
        await sign({ ...base, sub: `${immutable}:ref:refs/heads/main` }),
        env,
        now,
        fetcher,
      )
    ).run_id,
    "100",
  );
  assert.equal(
    (
      await verifyTelemetryToken(
        await sign({
          ...base,
          sub: `${immutable}:environment:production`,
          workflow_ref:
            "UnregisteredMusket/Lootsplit/.github/workflows/website-release.yml@refs/heads/main",
        }),
        env,
        now,
        fetcher,
      )
    ).run_id,
    "100",
  );
  assert.equal(
    (
      await verifyTelemetryToken(
        await sign({
          ...base,
          workflow_ref:
            "UnregisteredMusket/Lootsplit/.github/workflows/website-release.yml@refs/heads/main",
          sub: "repo:UnregisteredMusket/Lootsplit:environment:production",
        }),
        env,
        now,
        fetcher,
      )
    ).run_id,
    "100",
  );
  for (const override of [
    { repository_id: "1" },
    { run_attempt: "" },
    { sub: "repo:UnregisteredMusket/Lootsplit:environment:production" },
    { repository_owner_id: "1" },
    { ref: "refs/pull/1/merge" },
    { aud: "wrong" },
    { sub: "repo:other/other:ref:refs/heads/main" },
    { sub: "repo:UnregisteredMusket@1/Lootsplit@1398794793:ref:refs/heads/main" },
    { sub: "repo:UnregisteredMusket@336285553/Lootsplit@1:ref:refs/heads/main" },
    { sub: `${immutable}:ref:refs/heads/other` },
    { sub: `${immutable}:environment:production` },
    { exp: now / 1000 - 1 },
    { event_name: "pull_request" },
    { workflow_ref: "UnregisteredMusket/Lootsplit/.github/workflows/evil.yml@refs/heads/main" },
  ])
    await assert.rejects(
      () =>
        sign({ ...base, ...override }).then((token) =>
          verifyTelemetryToken(token, env, now, fetcher),
        ),
      /not authorized/,
    );
  const valid = await sign(base),
    parts = valid.split(".");
  parts[1] = encoded({ ...base, run_id: "101" });
  await assert.rejects(() => verifyTelemetryToken(parts.join("."), env, now, fetcher), /signature/);
});

test("forged key IDs cannot force a signing-key download on every request", async () => {
  const now = Date.now();
  const claims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: "https://lootsplit.oliverstorie2017.workers.dev/monitoring",
    repository: "UnregisteredMusket/Lootsplit",
    repository_id: "1398794793",
    repository_owner_id: "336285553",
    ref: "refs/heads/main",
    sub: "repo:UnregisteredMusket/Lootsplit:ref:refs/heads/main",
    workflow_ref: "UnregisteredMusket/Lootsplit/.github/workflows/verify.yml@refs/heads/main",
    event_name: "push",
    run_id: "200",
    run_attempt: "1",
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 300,
  };
  const forged = (kid) =>
    `${encoded({ alg: "RS256", typ: "JWT", kid })}.${encoded(claims)}.${encoded("not-a-signature")}`;
  let downloads = 0;
  const env = { DB: {} },
    fetcher = async () => {
      downloads++;
      return Response.json({ keys: [{ kid: "real", kty: "RSA", n: "AQAB", e: "AQAB" }] });
    };
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      verifyTelemetryToken(forged(`random-${i}`), env, now + i * 1000, fetcher),
      (e) => e.status === 401,
    );
  assert.equal(downloads, 1, "unknown key IDs reuse the cached key set within a minute");
  await assert.rejects(verifyTelemetryToken(forged("later"), env, now + 61000, fetcher));
  assert.equal(downloads, 2, "a rotated key can still be fetched after the minute passes");
});
