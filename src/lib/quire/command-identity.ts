import { commandSchema } from "./commands.ts";
import { canonicalJson } from "./canonical-json.ts";
export { canonicalJson } from "./canonical-json.ts";

/** Compare the command the server will execute, including schema defaults/trim. */
export function commandIdentity(value: unknown): string {
  return canonicalJson(commandSchema.parse(value));
}
export function sameCommand(a: unknown, b: unknown): boolean {
  return commandIdentity(a) === commandIdentity(b);
}

/** A short, stable fingerprint of an action, for duplicate-submission checks. */
export async function actionDigest(identity: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return "v2:" + Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
