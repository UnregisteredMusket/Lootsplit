/** Owner-authorized local sessions: LOOTSPLIT_OWNER_TOKEN is supplied securely, never echoed. */
import { readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!process.env.LOOTSPLIT_OWNER_TOKEN)
  throw Error(
    "Supply the current owner session through LOOTSPLIT_OWNER_TOKEN, or use My account → Field monitor → Development task.",
  );
const response = await fetch(
  "https://lootsplit.oliverstorie2017.workers.dev/api/account/owner/monitor/task",
  {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${process.env.LOOTSPLIT_OWNER_TOKEN}`,
      "Content-Type": "application/json",
      Origin: "https://lootsplit.oliverstorie2017.workers.dev",
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
