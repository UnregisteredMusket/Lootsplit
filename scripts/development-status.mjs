/** Owner-authorized local sessions: LOOTSPLIT_OWNER_TOKEN is supplied securely, never echoed. */
import { readFileSync } from "node:fs";
import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!process.env.LOOTSPLIT_OWNER_TOKEN)
  throw Error(
    "Supply the current owner session through LOOTSPLIT_OWNER_TOKEN, or use My account → Field monitor → Development task.",
  );
// The Origin must equal the host that receives the request (accounts.mjs), so both come from one value.
const response = await fetch(
  new URL("/api/account/owner/monitor/task", deploymentOrigins.website),
  {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${process.env.LOOTSPLIT_OWNER_TOKEN}`,
      "Content-Type": "application/json",
      Origin: deploymentOrigins.website,
    },
    body: JSON.stringify(input),
  },
);
if (!response.ok)
  throw Error(
    `Task publication failed (${response.status}); check authorization or revision before retrying.`,
  );
const task = await response.json();
console.log(
  JSON.stringify({
    id: task.id,
    revision: task.revision,
    state: task.state,
    heartbeatAt: task.heartbeatAt,
  }),
);
