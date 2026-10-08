// Standalone audits use top-level async work. Keep their process alive while a
// dependency or browser promise is pending so idle Node cannot report exit 0
// before the original final assertions. Existing action/CI bounds still apply.
const hold = setInterval(() => {}, 1000);
export function finishAuditLiveness() {
  clearInterval(hold);
}
