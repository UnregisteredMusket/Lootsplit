import { z } from "zod";

export const referenceSections = ["items", "spells", "creatures"] as const;
export type ReferenceSection = (typeof referenceSections)[number];
export const referencePolicySchema = z
  .object({
    enabled: z.boolean(),
    sections: z
      .array(z.enum(referenceSections))
      .max(3)
      .refine(
        (sections) => new Set(sections).size === sections.length,
        "Choose each reference section once.",
      ),
    allowDuringEncounters: z.boolean(),
  })
  .strict();
export type ReferencePolicy = z.infer<typeof referencePolicySchema>;
export function referencePolicy(value?: ReferencePolicy): ReferencePolicy {
  return value ?? { enabled: true, sections: [...referenceSections], allowDuringEncounters: false };
}
export function referenceSection(kind: string): ReferenceSection {
  return kind === "spells" ? "spells" : kind === "creatures" ? "creatures" : "items";
}
export function referenceAccess(
  role: "dm" | "player",
  policy: ReferencePolicy | undefined,
  encounterActive: boolean,
  section?: ReferenceSection,
): { allowed: boolean; reason: string } {
  if (role === "dm") return { allowed: true, reason: "" };
  const p = referencePolicy(policy);
  if (!p.enabled) return { allowed: false, reason: "Reference lookup is disabled by your DM." };
  if (encounterActive && !p.allowDuringEncounters)
    return {
      allowed: false,
      reason: "Reference lookup is paused while an encounter is active. Your DM can allow it.",
    };
  if (section ? !p.sections.includes(section) : !p.sections.length)
    return { allowed: false, reason: "This reference index is disabled by your DM." };
  return { allowed: true, reason: "" };
}
