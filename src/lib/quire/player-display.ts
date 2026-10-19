import { z } from "zod";
import { artworkSchema } from "./artwork.ts";
import { mapGridSchema, readWorld } from "./world-schema.ts";
import { characterVisible } from "./character-position.ts";
import { sceneTokenPoint } from "./tabletop-geometry.ts";
import { confirmedLootSummary } from "../encounters/presentation.ts";
import type { encounterSchema } from "../encounters/model.mjs";
import type { CloudTable } from "./cloud.ts";
import { projectTabletopMap } from "./tabletop.ts";

export type DisplayEncounter = {
  id: string;
  code: string;
  revision: number;
  status: string;
  body: z.infer<typeof encounterSchema>;
  award: { receiptId: string; at: number } | null;
};
export type DisplaySettings = {
  mapId: string;
  encounterId: string;
  combatantIds: string[];
  showHp: boolean;
  showConditions: boolean;
  showLoot: boolean;
  grid: boolean;
  tokens: boolean;
  paused: boolean;
  rotation: number;
  zoom: number;
  panX: number;
  panY: number;
  tilePixels: number;
};
export const defaultDisplaySettings: DisplaySettings = {
  mapId: "",
  encounterId: "",
  combatantIds: [],
  showHp: false,
  showConditions: false,
  showLoot: false,
  grid: false,
  tokens: true,
  paused: true,
  rotation: 0,
  zoom: 100,
  panX: 0,
  panY: 0,
  tilePixels: 0,
};
const point = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), label: z.string().max(160) })
  .strict();
export const playerDisplaySchema = z
  .object({
    version: z.literal(1),
    paused: z.boolean(),
    camera: z
      .object({
        rotation: z.number().int().min(0).max(270).multipleOf(90),
        zoom: z.number().min(25).max(400),
        panX: z.number().min(-100).max(100),
        panY: z.number().min(-100).max(100),
        tilePixels: z.number().min(0).max(250),
      })
      .strict(),
    map: z
      .object({
        name: z.string().max(160),
        image: artworkSchema,
        grid: mapGridSchema.nullable(),
        showGrid: z.boolean(),
        markers: z.array(point).max(500),
        tokens: z.array(point.extend({ active: z.boolean() }).strict()).max(200),
      })
      .strict()
      .nullable(),
    encounter: z
      .object({
        round: z.number().int().min(1),
        status: z.string().max(30),
        combatants: z
          .array(
            z
              .object({
                name: z.string().max(120),
                initiative: z.number().nullable(),
                active: z.boolean(),
                hp: z.number().nullable(),
                maxHp: z.number().nullable(),
                conditions: z.string().max(500),
              })
              .strict(),
          )
          .max(100),
      })
      .strict()
      .nullable(),
    loot: z
      .object({
        receiptId: z.string().max(120),
        text: z.string().max(2000),
        items: z
          .array(
            z.object({ name: z.string().max(120), quantity: z.number().int().positive() }).strict(),
          )
          .max(200),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PlayerDisplayFrame = z.infer<typeof playerDisplaySchema>;

/** The display receives this allowlist only, never the campaign or a DM encounter body. */
export function projectPlayerDisplay(
  table: Pick<CloudTable, "journal" | "purses">,
  detail: DisplayEncounter | null,
  settings: DisplaySettings,
  campaignCode: string,
): PlayerDisplayFrame {
  const empty: PlayerDisplayFrame = {
    version: 1,
    paused: true,
    camera: {
      rotation: settings.rotation,
      zoom: settings.zoom,
      panX: settings.panX,
      panY: settings.panY,
      tilePixels: settings.tilePixels,
    },
    map: null,
    encounter: null,
    loot: null,
  };
  if (settings.paused) return playerDisplaySchema.parse(empty);
  const encounter =
    detail && detail.id === settings.encounterId && detail.code === campaignCode ? detail : null;
  const visible =
    encounter?.body.combatants.filter((c) => settings.combatantIds.includes(c.id)) ?? [];
  const sourceMap = readWorld(table.journal?.world).maps.find(
    (m) => m.id === settings.mapId && m.visible,
  );
  const map = sourceMap
    ? projectTabletopMap(table, sourceMap, { role: "player", purseIds: [] }, true)
    : undefined;
  const award = settings.showLoot && encounter ? confirmedLootSummary(encounter) : null;
  return playerDisplaySchema.parse({
    ...empty,
    paused: false,
    map: map
      ? {
          name: map.name,
          image: map.image,
          grid: map.grid ?? null,
          showGrid: settings.grid,
          markers: map.markers
            .filter((m) => m.visibility === "party")
            .map((m) => ({ x: m.x, y: m.y, label: m.label })),
          tokens:
            settings.tokens && map.grid
              ? (map.tokens ?? [])
                  .filter((t) => {
                    if (
                      t.visibility !== "party" ||
                      t.column >= map.grid!.columns ||
                      t.row >= map.grid!.rows
                    )
                      return false;
                    if (t.kind === "character") {
                      const p = table.purses.find((p) => p.id === t.entityId);
                      return !!p && characterVisible(table, p);
                    }
                    if (t.kind === "creature")
                      return (
                        t.encounterId === encounter?.id &&
                        visible.some((c) => c.id === t.combatantId)
                      );
                    return true;
                  })
                  .map((t) => ({
                    ...sceneTokenPoint(map.grid!, t),
                    label: t.label,
                    active:
                      !!encounter &&
                      t.encounterId === encounter.id &&
                      t.combatantId === encounter.body.activeId,
                  }))
              : [],
        }
      : null,
    encounter: encounter
      ? {
          round: encounter.body.round,
          status: encounter.status,
          combatants: visible.map((c) => ({
            name: c.name,
            initiative: c.initiative,
            active: c.id === encounter.body.activeId,
            hp: settings.showHp ? c.hp : null,
            maxHp: settings.showHp ? c.maxHp : null,
            conditions: settings.showConditions ? c.conditions : "",
          })),
        }
      : null,
    loot:
      award && encounter
        ? {
            receiptId: award.receiptId,
            text: award.text,
            items: encounter.body.loot.map((i) => ({ name: i.name, quantity: i.quantity })),
          }
        : null,
  });
}

export const displayChannelName = (id: string) => `lootsplit.player-display.${id}`;
export const validDisplayId = (id: string) => /^[a-f0-9-]{36}$/.test(id);

/** Presentation transport only. No account/session/campaign context is copied. */
export function openPlayerDisplay(id: string, tab = false) {
  if (!validDisplayId(id)) throw Error("Invalid display session.");
  const child = window.open("about:blank", "_blank", tab ? "" : "popup,width=1280,height=800");
  if (!child) throw Error("Allow pop-ups for Lootsplit, then open the player display again.");
  try {
    child.sessionStorage.clear();
    child.opener = null;
    child.location.replace(`${window.location.origin}/player-display#${id}`);
    child.focus();
  } catch {
    child.close();
    throw Error("This browser could not open a player display.");
  }
}

/** Physical calibration makes each logical tile square on the display, including cropped grids. */
export function displayMapSize(
  image: { width: number; height: number },
  viewport: { width: number; height: number },
  grid: z.infer<typeof mapGridSchema> | null,
  camera: Pick<DisplaySettings, "rotation" | "zoom" | "tilePixels">,
) {
  const rotated = camera.rotation % 180 !== 0;
  const fit = Math.min(
    (rotated ? viewport.height : viewport.width) / image.width,
    (rotated ? viewport.width : viewport.height) / image.height,
  );
  const zoom = camera.zoom / 100;
  return grid && camera.tilePixels
    ? {
        width: ((camera.tilePixels * grid.columns) / grid.width) * zoom,
        height: ((camera.tilePixels * grid.rows) / grid.height) * zoom,
      }
    : { width: image.width * fit * zoom, height: image.height * fit * zoom };
}
