import { z } from "zod";
import { rollSpec, parseDice, throwDice } from "./model.mjs";
export const campaignRollSchema = z.object({
  requestKey: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
  revision: z.number().int().nonnegative(),
  kind: z.string().max(30),
  key: z.string().max(100).optional(),
  label: z.string().max(120).optional(),
  formula: z.string().max(120).optional(),
  manual: z.boolean().optional(),
  total: z.number().int().min(-100000).max(100000).optional(),
  mode: z.enum(["normal", "advantage", "disadvantage"]).optional(),
});
/** @param {import("./model.mjs").PlaySheet} sheet
 * @param {unknown} input @param {string} actor @param {string} characterId
 * @param {string} source @param {boolean} manualAllowed */
export function makeCampaignRoll(sheet, input, actor, characterId, source, manualAllowed) {
  const b = campaignRollSchema.parse(input);
  if (b.manual && !manualAllowed)
    throw Error("The DM has disabled manual rolls for this campaign.");
  if (b.manual && b.total === undefined) throw Error("Enter a whole-number manual total.");
  const spec =
    b.kind === "custom"
      ? { label: b.label || "Custom roll", formula: b.formula || "" }
      : rollSpec(sheet, b.kind, b.key || "");
  const result = b.manual
    ? { ...parseDice(spec.formula), dice: [], mode: "manual", total: b.total }
    : throwDice(spec.formula, b.mode || "normal");
  return {
    id: b.requestKey,
    characterId,
    character: sheet.name,
    actor,
    ...spec,
    ...result,
    source: b.manual ? "manual" : source,
  };
}
