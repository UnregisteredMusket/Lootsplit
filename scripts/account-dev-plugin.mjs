import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { localAccountDb } from "./account-dev-db.mjs";
import { handleAccounts } from "../cloudflare/accounts.mjs";
export function accountDevPlugin() {
  return {
    name: "lootsplit-account-dev",
    apply: "serve",
    configureServer(server) {
      mkdirSync("data", { recursive: true });
      const secretPath = "data/account-dev-secret";
      if (!existsSync(secretPath))
        writeFileSync(secretPath, randomBytes(32).toString("hex"), { mode: 0o600 });
      const DB = localAccountDb("data/account-dev.sqlite");
      globalThis.__env__ = { DB }; // Match production: room and account APIs share D1.
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/account/")) return next();
        try {
          const origin = `http://${req.headers.host}`;
          const request = new Request(origin + req.url, {
            method: req.method,
            headers: req.headers,
            ...(req.method === "POST" ? { body: req, duplex: "half" } : {}),
          });
          const response = await handleAccounts(request, {
            DB,
            ACCOUNT_SECRET: readFileSync(secretPath, "utf8"),
            ACCOUNT_ORIGIN: origin,
          });
          res.statusCode = response.status;
          response.headers.forEach((v, k) => {
            if (k !== "set-cookie") res.setHeader(k, v);
          });
          if (response.headers.getSetCookie().length)
            res.setHeader("set-cookie", response.headers.getSetCookie());
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.statusCode = 500;
          res.end("Account service unavailable");
        }
      });
    },
  };
}
