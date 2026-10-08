// An explicit downtime handoff may replace the session form. Keep its name only
// in this document, never in persistent guest storage or another campaign.
const handoffs = new Map<string, string>();

export function rememberSessionName(scope: string, name: string) {
  if (name) handoffs.set(scope, name);
  else handoffs.delete(scope);
}

export function takeSessionName(scope: string): string {
  const name = handoffs.get(scope) ?? "";
  handoffs.delete(scope);
  return name;
}

export function peekSessionName(scope: string): string {
  return handoffs.get(scope) ?? "";
}

export function forgetSessionName(scope: string) {
  handoffs.delete(scope);
}
