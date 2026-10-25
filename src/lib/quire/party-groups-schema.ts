/**
 * Split the party commands (tabletop protocol 10; party-groups-command.ts). Groups move no money:
 * a group that goes somewhere else at once passes no time and charges nothing, like Move party
 * here. The DM splits, edits, assigns and merges; a group's players may only ask to move it.
 */
import { z } from "zod";
import { groupColours, mainGroupSchema } from "./world-schema.ts";

const id = z.string().min(1).max(150);
const name = z.string().trim().min(1).max(60);
/** `partyGroupsFingerprint` of the table the DM saw. */
const before = z.string().max(500000);
const reason = z.object({ text: z.string().trim().max(500), showToPlayer: z.boolean() }).strict();
export const partyGroupCommands = [
  z
    .object({
      id,
      kind: z.literal("party-split"),
      before,
      groups: z
        .array(
          z
            .object({
              id,
              name,
              colour: z.enum(groupColours),
              locationId: id.nullable(),
              memberIds: z.array(id).min(1).max(500),
            })
            .strict(),
        )
        .min(1)
        .max(5),
      /** The main group's label (it keeps the party's place). */
      main: mainGroupSchema.optional(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("party-group-edit"),
      before,
      /** "main" or a group ID. */
      groupId: id,
      name,
      colour: z.enum(groupColours),
      hidden: z.boolean(),
    })
    .strict(),
  z.object({ id, kind: z.literal("party-group-assign"), before, purseId: id, groupId: id }).strict(),
  z
    .object({
      id,
      kind: z.literal("party-merge"),
      before,
      groupIds: z.array(id).min(2).max(6),
      intoLocationId: id.nullable(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("party-group-request"),
      requestId: id,
      groupId: id,
      purseId: id,
      locationId: id,
      message: z.string().trim().max(500).optional(),
    })
    .strict(),
  z.object({ id, kind: z.literal("party-group-request-withdraw"), requestId: id }).strict(),
  z
    .object({
      id,
      kind: z.literal("party-group-request-review"),
      requestId: id,
      approve: z.boolean(),
      reason: reason.optional(),
    })
    .strict(),
] as const;
export type PartyGroupCommand = z.infer<(typeof partyGroupCommands)[number]>;
export const partyGroupKinds = new Set<string>(partyGroupCommands.map((c) => c.shape.kind.value));
