// Decides whether an already-published Android version may be skipped instead of failing.
// Only an explicit opt-in on a push that did not change APP_VERSION can skip; every other
// case (manual run, new/changed version, unknown history) keeps the existing hard failure.
export function releasedVersionDecision({ optIn, eventName, before, previousVersion, version }) {
  if (!optIn) return { skip: false, reason: "skip mode not requested" };
  if (eventName !== "push") return { skip: false, reason: `event ${eventName || "unknown"}` };
  if (!/^[0-9a-f]{40}$/.test(before || "") || /^0+$/.test(before))
    return { skip: false, reason: "no previous commit for this push" };
  if (!previousVersion) return { skip: false, reason: "previous version unreadable" };
  if (previousVersion !== version)
    return { skip: false, reason: `push changed APP_VERSION ${previousVersion} -> ${version}` };
  return { skip: true, reason: `push did not change APP_VERSION ${version}` };
}

export function appVersion(source) {
  return source?.match(/APP_VERSION = "([^"]+)"/)?.[1];
}
