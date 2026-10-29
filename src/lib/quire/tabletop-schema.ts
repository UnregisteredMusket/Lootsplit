import { z } from "zod";
import { mapMediaReferenceSchema, mapRenderedFrameSchema } from "./map-assets-schema.ts";
import { TOKEN_SIZE_CLASSES } from "./tabletop-geometry.ts";

const id = z.string().min(1).max(150);
export const scenePointSchema = z
  .object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) })
  .strict();
export const sceneCameraSchema = z
  .object({
    x: z.number().finite().min(-5).max(5),
    y: z.number().finite().min(-5).max(5),
    zoom: z.number().finite().min(0.1).max(8),
  })
  .strict();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const fogShapeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id,
      kind: z.literal("rectangle"),
      reveal: z.boolean(),
      a: scenePointSchema,
      b: scenePointSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ellipse"),
      reveal: z.boolean(),
      a: scenePointSchema,
      b: scenePointSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("polygon"),
      reveal: z.boolean(),
      points: z.array(scenePointSchema).min(3).max(200),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("brush"),
      reveal: z.boolean(),
      points: z.array(scenePointSchema).min(1).max(200),
      radius: z.number().finite().min(0.001).max(0.5),
    })
    .strict(),
]);
export const fogStateSchema = z
  .object({
    enabled: z.boolean().default(false),
    base: z.enum(["revealed", "concealed"]).default("concealed"),
    shapes: z.array(fogShapeSchema).max(500).default([]),
  })
  .strict();
/**
 * Compact fog history entry (tabletop protocol 3): the state it restores is the current fog's
 * first `keep` shapes followed by `add`, with `enabled`/`base` replaced. Entries are relative to
 * the state above them on their stack (the top one to the current fog). Older rooms may still hold
 * full `fogStateSchema` snapshots, which stay readable and are converted on the next fog write.
 */
export const fogDiffSchema = z
  .object({
    kind: z.literal("fog-diff"),
    keep: z.number().int().min(0).max(500),
    add: z.array(fogShapeSchema).max(500),
    enabled: z.boolean(),
    base: z.enum(["revealed", "concealed"]),
  })
  .strict();
export const fogHistoryEntrySchema = z.union([fogDiffSchema, fogStateSchema]);
export const wallSchema = z
  .object({
    id,
    a: scenePointSchema,
    b: scenePointSchema,
    kind: z.enum(["wall", "door", "window", "secret-door"]).default("wall"),
    open: z.boolean().default(false),
    blocksSight: z.boolean().default(true),
    blocksMovement: z.boolean().default(false),
  })
  .strict();
export const sceneLightSchema = z
  .object({
    id,
    at: scenePointSchema,
    radiusFeet: z.number().finite().positive().max(1000000),
    color,
    visible: z.boolean().default(true),
  })
  .strict();
export const areaTemplateSchema = z
  .object({
    id,
    label: z.string().trim().max(100).default(""),
    kind: z.enum(["circle", "cone", "rectangle", "ray"]),
    origin: scenePointSchema,
    distanceFeet: z.number().finite().positive().max(1000000),
    widthFeet: z.number().finite().positive().max(1000000).default(5),
    direction: z.number().finite().min(0).max(360).default(0),
    angle: z.number().finite().min(1).max(360).default(90),
    visibility: z.enum(["party", "dm"]).default("party"),
    controllerPurseId: id.optional(),
  })
  .strict();
export const tokenTabletopFields = {
  locked: z.boolean().optional(),
  controllerPurseIds: z.array(id).max(100).optional(),
  offsetX: z.number().finite().min(-0.5).max(0.5).optional(),
  offsetY: z.number().finite().min(-0.5).max(0.5).optional(),
  style: z
    .object({
      color: color.optional(),
      size: z.number().finite().min(0.25).max(8).default(1),
      labels: z.enum(["always", "selected", "never"]).default("always"),
    })
    .strict()
    .optional(),
  vision: z
    .object({
      enabled: z.boolean().default(true),
      rangeFeet: z.number().finite().positive().max(1000000).default(60),
      darkvisionFeet: z.number().finite().min(0).max(1000000).default(0),
    })
    .strict()
    .optional(),
  /**
   * Tabletop protocol 13 (footprints): the creature size, the DM's custom squares per side (0.25
   * is a Tiny-style quarter square) and `anchor: "corner"`, which stores the token by its
   * top-left square. Tokens without `anchor` keep their centre square. Older clients receive
   * footprint tokens in that centre form (tabletop-protocol.ts).
   */
  sizeClass: z.enum(TOKEN_SIZE_CLASSES).optional(),
  footprint: z.union([z.literal(0.25), z.number().int().min(1).max(8)]).optional(),
  anchor: z.literal("corner").optional(),
};
export const mapTabletopSchema = z
  .object({
    revision: z.number().int().nonnegative().default(0),
    playerMovement: z.boolean().default(false),
    /**
     * Tabletop protocol 15 (player movement, owner 2026-10-29): "auto" = players move their own
     * tokens freely, taking turns while combat is active on this map; "off" = DM only; "approval"
     * = players' moves wait for the DM. Absent: "auto" for maps without tabletop settings, else
     * from `playerMovement` (kept in step for older clients). See `movementMode` (tabletop.ts).
     */
    movement: z.enum(["auto", "off", "approval"]).optional(),
    /** Characters who may not move on this map, kept when their token is removed and placed again. */
    lockedPurseIds: z.array(id).max(200).optional(),
    playerTemplates: z.boolean().default(false),
    snap: z.boolean().default(true),
    /**
     * Tabletop protocol 14 (grid mode): the automatic grid of an ungridded map is hidden until the
     * DM shows it. Absent means the lines are drawn as before.
     */
    gridHidden: z.boolean().optional(),
    unitLabel: z.string().trim().min(1).max(20).default("ft"),
    unitsPerFoot: z.number().finite().positive().max(1000000).default(1),
    initialView: sceneCameraSchema.optional(),
    media: mapMediaReferenceSchema.optional(),
    frames: z.array(mapRenderedFrameSchema).max(201).default([]),
    fog: fogStateSchema.default({ enabled: false, base: "concealed", shapes: [] }),
    fogUndo: z.array(fogHistoryEntrySchema).max(20).default([]),
    fogRedo: z.array(fogHistoryEntrySchema).max(20).default([]),
    vision: z.enum(["off", "party", "individual"]).default("off"),
    ambientLight: z.boolean().default(true),
    walls: z.array(wallSchema).max(1000).default([]),
    lights: z.array(sceneLightSchema).max(200).default([]),
    templates: z.array(areaTemplateSchema).max(200).default([]),
  })
  .strict();
export const tabletopSessionSchema = z
  .object({
    presentation: z
      .object({ id, mapId: id, mode: z.enum(["grid", "theatre"]) })
      .strict()
      .nullable()
      .optional(),
    tvEnabled: z.boolean().default(false),
    activeMapId: id.nullable().default(null),
    activationId: id.optional(),
    playerBrowsing: z.boolean().default(true),
    camera: z
      .object({ mapId: id, view: sceneCameraSchema, nonce: id })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
const tile = z
  .object({
    column: z.number().int().min(0).max(199),
    row: z.number().int().min(0).max(199),
    offsetX: z.number().finite().min(-0.5).max(0.5).optional(),
    offsetY: z.number().finite().min(-0.5).max(0.5).optional(),
  })
  .strict();
export const tabletopCommands = [
  z
    .object({
      id,
      kind: z.literal("map-render"),
      mapId: id,
      revision: z.number().int().nonnegative(),
      beforeFrameId: z.string().uuid().nullable(),
      frame: mapRenderedFrameSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("tabletop-session"),
      before: tabletopSessionSchema.nullable(),
      session: tabletopSessionSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("map-tabletop"),
      mapId: id,
      before: mapTabletopSchema.nullable(),
      settings: mapTabletopSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("map-token-move"),
      mapId: id,
      grid: z.string().max(1000).optional(),
      moves: z
        .array(z.object({ tokenId: id, before: tile, after: tile }).strict())
        .min(1)
        .max(100),
      ignoreWalls: z.boolean().default(false),
    })
    .strict(),
  /**
   * A player places their own character's token (map tokens PR 2): only on a map they can see,
   * with player movement on, no token of that character there yet, a snapped visible square and,
   * during combat on this map, on that character's turn. The server builds the token.
   */
  z
    .object({
      id,
      kind: z.literal("map-token-claim"),
      mapId: id,
      grid: z.string().max(1000),
      purseId: id,
      tokenId: id,
      at: tile,
    })
    .strict(),
  /**
   * Grid mode on with "Snap tokens to the nearest squares" (owner, 2026-10-29), and its Undo: one
   * DM command that sets grid mode and moves the listed tokens, revision-checked by the map's
   * settings and every token's position. Moves into grid mode must already be snapped.
   */
  z
    .object({
      id,
      kind: z.literal("map-grid-snap"),
      mapId: id,
      grid: z.string().max(1000),
      before: mapTabletopSchema.nullable(),
      snap: z.boolean(),
      moves: z
        .array(z.object({ tokenId: id, before: tile, after: tile }).strict())
        .max(200),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("map-fog"),
      mapId: id,
      before: fogStateSchema,
      action: z.enum([
        "shape",
        "undo",
        "redo",
        "reveal-all",
        "conceal-all",
        "enable",
        "disable",
        "consolidate",
      ]),
      shape: fogShapeSchema.optional(),
      /** Consolidate: the fog the DM's device computed and confirmed; the server must agree. */
      result: fogStateSchema.optional(),
      /** Continued segments of one long brush stroke, added in the same undo step (protocol 3). */
      continued: z.array(fogShapeSchema).min(1).max(19).optional(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("map-template"),
      mapId: id,
      templateId: id,
      before: areaTemplateSchema.nullable(),
      template: areaTemplateSchema.nullable(),
    })
    .strict(),
] as const;
export type ScenePoint = z.infer<typeof scenePointSchema>;
export type SceneCamera = z.infer<typeof sceneCameraSchema>;
export type FogShape = z.infer<typeof fogShapeSchema>;
export type FogState = z.infer<typeof fogStateSchema>;
export type FogDiff = z.infer<typeof fogDiffSchema>;
export type FogHistoryEntry = z.infer<typeof fogHistoryEntrySchema>;
export type SceneWall = z.infer<typeof wallSchema>;
export type SceneLight = z.infer<typeof sceneLightSchema>;
export type AreaTemplate = z.infer<typeof areaTemplateSchema>;
export type MapTabletop = z.infer<typeof mapTabletopSchema>;
export type TabletopSession = z.infer<typeof tabletopSessionSchema>;
export type TabletopCommand = z.infer<(typeof tabletopCommands)[number]>;
