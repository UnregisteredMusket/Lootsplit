import { z } from "zod";
import { sceneCameraSchema, scenePointSchema } from "./tabletop-schema.ts";
const id = z.string().min(1).max(150);
export const mapRecordTypes = [
  "location",
  "shop",
  "npc",
  "character",
  "property",
  "listing",
  "exchange",
  "facility",
  "entry",
  "handout",
] as const;
export const mapRecordReferenceSchema = z.object({ kind: z.enum(mapRecordTypes), id }).strict();
export const mapPlacementSchema = scenePointSchema
  .extend({
    id,
    record: mapRecordReferenceSchema,
    visibility: z.enum(["party", "dm"]),
    label: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
export const sceneLinkSchema = scenePointSchema
  .extend({
    id,
    targetMapId: id,
    label: z.string().trim().min(1).max(160),
    visibility: z.enum(["party", "dm"]),
    entry: sceneCameraSchema.optional(),
  })
  .strict();
export const connectedMapSchema = z
  .object({
    parentMapId: id.optional(),
    defaultForLocation: z.enum(["regional", "local", "battle"]).optional(),
    placedRecords: z.array(mapRecordReferenceSchema).max(500).optional(),
    links: z.array(sceneLinkSchema).max(200).default([]),
    placements: z.array(mapPlacementSchema).max(500).default([]),
  })
  .strict();
export type MapRecordReference = z.infer<typeof mapRecordReferenceSchema>;
export type MapPlacement = z.infer<typeof mapPlacementSchema>;
export type SceneLink = z.infer<typeof sceneLinkSchema>;
export type ConnectedMap = z.infer<typeof connectedMapSchema>;
