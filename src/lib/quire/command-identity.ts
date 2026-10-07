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
