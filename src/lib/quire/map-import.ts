import { z } from "zod";
import { mapTabletopSchema } from "./tabletop-schema.ts";
import { mapGridSchema } from "./world-schema.ts";

export const MAP_INTERCHANGE_LIMIT = 30_000_000;
const point = z.object({
  x: z.number().finite().min(-1e6).max(1e6),
  y: z.number().finite().min(-1e6).max(1e6),
});
const schema = z.object({
  format: z.union([z.literal(0.2), z.literal(0.3)]),
  resolution: z.object({
    map_origin: point,
    map_size: z.object({
      x: z.number().int().min(1).max(200),
      y: z.number().int().min(1).max(200),
    }),
    pixels_per_grid: z.number().finite().positive().max(8192),
  }),
  line_of_sight: z.array(z.array(point).min(2).max(1001)).max(1000).default([]),
  objects_line_of_sight: z.array(z.array(point).min(2).max(1001)).max(1000).default([]),
  portals: z
    .array(
      z.object({
        bounds: z.array(point).length(2),
        closed: z.boolean(),
        freestanding: z.boolean().optional(),
      }),
    )
    .max(1000)
    .default([]),
  lights: z
    .array(
      z.object({
        position: point,
        range: z.number().finite().positive().max(200000),
        color: z.string().regex(/^[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/),
        intensity: z.number().finite().min(0).max(1).optional(),
        shadows: z.boolean().optional(),
      }),
    )
    .max(200)
    .default([]),
  environment: z
    .object({
      baked_lighting: z.boolean().optional(),
      ambient_light: z
        .string()
        .regex(/^[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/)
        .optional(),
    })
    .optional(),
  image: z
    .string()
    .min(4)
    .max(27_000_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
type Point = { x: number; y: number };
/** Clip exporter geometry to the image rectangle; retain a visible review warning. */
function clip(a: Point, b: Point): [Point, Point] | undefined {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let low = 0,
    high = 1;
  for (const [p, q] of [
    [-dx, a.x],
    [dx, 1 - a.x],
    [-dy, a.y],
    [dy, 1 - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return;
      continue;
    }
    const r = q / p;
    if (p < 0) low = Math.max(low, r);
    else high = Math.min(high, r);
    if (low > high) return;
  }
  return [
    { x: Math.max(0, Math.min(1, a.x + low * dx)), y: Math.max(0, Math.min(1, a.y + low * dy)) },
    { x: Math.max(0, Math.min(1, a.x + high * dx)), y: Math.max(0, Math.min(1, a.y + high * dy)) },
  ];
}
/** Data only: no paths, URLs, scripts, module execution, or remote resources are followed. */
export function readMapInterchange(text: string, feetPerTile = 5) {
  if (new TextEncoder().encode(text).length > MAP_INTERCHANGE_LIMIT)
    throw Error("Choose a Universal VTT file up to 30 MB.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw Error("This map is not valid Universal VTT JSON.");
  }
  const result = schema.safeParse(json);
  if (!result.success)
    throw Error(
      "Unsupported map interchange. Use UVTT 0.2/0.3 with an embedded PNG/WebP, a 1–200 cell grid, at most 1,000 wall segments and 200 lights. Check the export's numeric values and metadata.",
    );
  const data = result.data,
    { map_origin: origin, map_size: size, pixels_per_grid: ppg } = data.resolution;
  if (size.x * ppg > 8192 || size.y * ppg > 8192 || size.x * size.y * ppg * ppg > 64_000_000)
    throw Error("The exported map exceeds 8192 pixels per edge or 64 megapixels.");
  const bytes = Uint8Array.from(atob(data.image), (value) => value.charCodeAt(0));
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71,
    webp =
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!png && !webp)
    throw Error(
      "Universal VTT requires an embedded PNG or WebP image. URLs and SVG are not imported.",
    );
  const normalized = (p: Point) => ({ x: (p.x - origin.x) / size.x, y: (p.y - origin.y) / size.y }),
    settings = mapTabletopSchema.parse({ fog: { enabled: true, base: "concealed" } }),
    warnings: string[] = [];
  let clipped = 0;
  function segment(a: Point, b: Point, kind: "wall" | "window" | "door", open = false) {
    if (settings.walls.length >= 1000)
      throw Error(
        "This file has more than 1,000 wall/door segments. Simplify the export before importing.",
      );
    const n = normalized(a),
      m = normalized(b),
      bounds = clip(n, m);
    if (!bounds) {
      clipped++;
      return;
    }
    if ([n, m].some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) clipped++;
    if (Math.hypot(bounds[0].x - bounds[1].x, bounds[0].y - bounds[1].y) < 1e-9) return;
    settings.walls.push({
      id: crypto.randomUUID(),
      a: bounds[0],
      b: bounds[1],
      kind,
      open,
      blocksSight: kind !== "window",
      blocksMovement: true,
    });
  }
  for (const [arrays, kind] of [
    [data.line_of_sight, "wall"],
    [data.objects_line_of_sight, "window"],
  ] as const)
    for (const points of arrays)
      for (let i = 1; i < points.length; i++) segment(points[i - 1], points[i], kind);
  for (const portal of data.portals)
    segment(portal.bounds[0], portal.bounds[1], "door", !portal.closed);
  for (const light of data.lights) {
    const at = normalized(light.position);
    if (at.x < 0 || at.x > 1 || at.y < 0 || at.y > 1) {
      clipped++;
      continue;
    }
    settings.lights.push({
      id: crypto.randomUUID(),
      at,
      radiusFeet: light.range * feetPerTile,
      color: "#" + light.color.slice(-6),
      visible: light.intensity !== 0,
    });
  }
  if (clipped)
    warnings.push(
      `${clipped} outside-image segments or lights were clipped or omitted; review the imported geometry.`,
    );
  if (data.objects_line_of_sight.length)
    warnings.push(
      "Object outlines become transparent movement barriers; review this approximation.",
    );
  if (data.lights.length)
    warnings.push(
      "Light radius/color are imported. Intensity and exporter-specific shadow effects are approximated; automatic vision stays off.",
    );
  if (data.environment?.baked_lighting)
    warnings.push("Lighting is already baked into this image and cannot be removed.");
  const supported = new Set([
    "format",
    "resolution",
    "line_of_sight",
    "objects_line_of_sight",
    "portals",
    "lights",
    "environment",
    "image",
    "software",
    "creator",
  ]);
  if (Object.keys(json as object).some((key) => !supported.has(key)))
    warnings.push(
      "Additional exporter metadata is ignored. Tokens, actors, scripts and other content are not imported.",
    );
  warnings.push(
    "Imported maps stay private and concealed until reviewed and shared. Cell scale defaults to 5 feet; review grid alignment, doors, light ranges and permissions before play.",
  );
  return {
    bytes,
    mime: png ? "image/png" : "image/webp",
    width: size.x * ppg,
    height: size.y * ppg,
    grid: mapGridSchema.parse({
      columns: size.x,
      rows: size.y,
      feetPerTile,
      diagonal: "euclidean",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }),
    settings,
    warnings,
  };
}
