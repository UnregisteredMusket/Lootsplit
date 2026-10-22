import test from "node:test";
import assert from "node:assert/strict";
import { guardMemberSeat } from "./member-access.server.ts";
test("linked room tokens honor active, expired, permanent and revoked account restrictions", async () => {
  const global = globalThis as typeof globalThis & { __env__?: unknown };
  const old = global.__env__;
  try {
    for (const linkedId of ["", "canonical-account"]) {
      for (const [row, blocked] of [
        [null, false],
        [{ status: "active", ban_until: null }, false],
        [{ status: "banned", ban_until: Date.now() - 1 }, false],
        [{ status: "banned", ban_until: Date.now() + 999999 }, true],
        [{ status: "banned", ban_until: null }, true],
        [{ status: "revoked", ban_until: null }, true],
      ] as const) {
        global.__env__ = {
          DB: {
            prepare: (sql: string) => ({
              bind: (...values: string[]) => {
                if (sql.includes("FROM campaign_rooms")) {
                  assert.equal(values[0], "ABC");
                  return {
                    first: async () =>
                      linkedId
                        ? {
                            revision: 1, ownerId: null, sessionId: null, closed: 0,
                            seats: JSON.stringify([
                                { id: "player", token: "token", role: "player", userId: linkedId },
                              ]),
                          }
                        : null,
                  };
                }
                const [identity, code, token] = values;
                assert.equal(identity, linkedId);
                assert.equal(code, "ABC");
                assert.equal(token, "token");
                return { first: async () => row };
              },
            }),
          },
        };
        if (blocked)
          await assert.rejects(
            guardMemberSeat({ code: "abc", token: "token" }),
            /restricted account/,
          );
        else await guardMemberSeat({ code: "abc", token: "token" });
      }
    }
  } finally {
    global.__env__ = old;
  }
});

test("server-function identity resolves on approved legacy hosts and never on unapproved hosts", async () => {
  const { accountIdForRequest } = await import("./member-access.server.ts");
  const { handleAccounts } = await import("../../../cloudflare/accounts.mjs");
  // Disposable local SQLite (the same helper scripts/domain-readiness.test.mjs uses); loaded by URL so the
  // app typecheck does not pull the untyped dev helper into src.
  const { localAccountDb } = await import(new URL("../../../scripts/account-dev-db.mjs", import.meta.url).href);
  const db = localAccountDb();
  const base = { DB: db, ACCOUNT_SECRET: "disposable-member-origin-secret-123456789", ACCOUNT_ORIGIN: "https://new.test" };
  const env = { ...base, ACCOUNT_LEGACY_ORIGINS: "https://old.test" };
  try {
    const data = { name: "Legacy host", email: "legacy-host@example.test", password: "disposable-test-password" };
    const signup = (await handleAccounts(
      new Request("https://old.test/api/account/auth/sign-up/email", { method: "POST", headers: { origin: "https://old.test", "content-type": "application/json" }, body: JSON.stringify(data) }),
      env,
    ))!;
    assert.equal(signup.status, 200, await signup.clone().text());
    const cookie = signup.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const call = (host: string, environment: typeof base, extra: Record<string, string> = {}) =>
      accountIdForRequest(environment, { url: host + "/_serverFn/abc", headers: new Headers({ cookie, ...extra }) });
    const userId = await call("https://old.test", env);
    assert.ok(userId, "legacy host listed in ACCOUNT_LEGACY_ORIGINS resolves the account");
    assert.equal(await call("https://new.test", env), userId);
    assert.equal(await call("https://old.test", base), undefined, "legacy host not listed is not approved");
    assert.equal(await call("https://attacker.test", env, { "x-forwarded-host": "new.test" }), undefined);
  } finally {
    db.close();
  }
});
