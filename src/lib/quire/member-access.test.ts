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
                if (sql.includes("SELECT body")) {
                  assert.equal(values[0], "ABC");
                  return {
                    first: async () =>
                      linkedId
                        ? {
                            body: JSON.stringify({
                              code: "ABC",
                              seats: [
                                { id: "player", token: "token", role: "player", userId: linkedId },
                              ],
                            }),
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
