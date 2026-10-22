import test from "node:test";
import assert from "node:assert/strict";
import { accountDurationSummary, noticeAnnotation } from "./account-durations.mjs";
import { failureAnnotation } from "./recovery-step.mjs";

const report = {
  suites: [
    {
      title: "account.spec.mjs",
      specs: [
        {
          title: "network-boundary",
          tests: [
            {
              annotations: [],
              results: [
                {
                  status: "passed",
                  duration: 12345,
                  workerIndex: 1,
                  startTime: "2026-10-22T08:00:00.500Z",
                },
              ],
            },
          ],
        },
        {
          title: "ownership",
          tests: [
            {
              annotations: [{ type: "phase", description: "legacy claimed 9.1s" }],
              results: [
                {
                  status: "timedOut",
                  duration: 60012,
                  workerIndex: 0,
                  startTime: "2026-10-22T08:00:00.000Z",
                  annotations: [
                    { type: "phase", description: "legacy claimed 9.1s" },
                    { type: "phase", description: "resumed 51.0s" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test("account cases are listed in start order with worker and offset, then phases", () => {
  assert.equal(
    accountDurationSummary(report),
    [
      "ownership timedOut 60.0s w0 +0.0s",
      "network-boundary passed 12.3s w1 +0.5s",
      "ownership phases: legacy claimed 9.1s, resumed 51.0s",
    ].join("\n"),
  );
});

test("an empty report is an explicit gap, never an empty annotation", () => {
  assert.match(accountDurationSummary({ suites: [] }), /No account cases were reported/);
});

test("the notice is one workflow command line", () => {
  const line = noticeAnnotation("Account case durations shard 1/2", "a 100%\nb");
  assert.equal(line, "::notice title=Account case durations shard 1/2::a 100%25%0Ab");
});

test("workflow command lines do not crowd a step's failure annotation", () => {
  const annotation = failureAnnotation(
    "dev-account-1",
    "failed",
    "1 failed\n" + noticeAnnotation("Account case durations", "ownership timedOut 60.0s"),
  );
  assert.match(annotation, /1 failed$/);
  assert.doesNotMatch(annotation, /notice/);
});
