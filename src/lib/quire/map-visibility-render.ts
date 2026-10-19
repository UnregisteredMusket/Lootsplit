import type { CampaignMap } from "./world-schema.ts";
import type { MapTabletop, ScenePoint } from "./tabletop-schema.ts";
import type { VisionSource } from "./tabletop-geometry.ts";
import { canvasBlob, mapThumbnail } from "./map-media.ts";
import { bundleMapAsset } from "./map-assets.ts";

type Point = { x: number; y: number };
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
/** Ray casting operates in the grid's physical units, including cropped/non-square grids. */
export function visionPolygon(
  origin: ScenePoint,
  range: number,
  map: CampaignMap,
  settings: MapTabletop,
): ScenePoint[] {
  if (!map.grid) return [];
  const sx = (map.grid.columns / map.grid.width) * map.grid.feetPerTile,
    sy = (map.grid.rows / map.grid.height) * map.grid.feetPerTile;
  const transform = (p: Point) => ({ x: (p.x - origin.x) * sx, y: (p.y - origin.y) * sy });
  const walls = settings.walls
    .filter((w) => !w.open && w.blocksSight)
    .map((w) => [transform(w.a), transform(w.b)] as const);
  const angles = Array.from({ length: 256 }, (_, i) => (i * Math.PI) / 128);
  for (const [a, b] of walls)
    for (const p of [a, b]) {
      const angle = Math.atan2(p.y, p.x);
      angles.push(angle - 1e-7, angle, angle + 1e-7);
    }
  return angles
    .map((angle) => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
    .sort((a, b) => a - b)
    .map((angle) => {
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      let distance = range;
      for (const [a, b] of walls) {
        const segment = { x: b.x - a.x, y: b.y - a.y },
          denominator = cross(direction, segment);
        if (Math.abs(denominator) < 1e-12) continue;
        const t = cross(a, segment) / denominator,
          u = cross(a, direction) / denominator;
        if (t >= 0 && u >= 0 && u <= 1) distance = Math.min(distance, Math.max(0, t - 1e-6));
      }
      return {
        x: origin.x + (direction.x * distance) / sx,
        y: origin.y + (direction.y * distance) / sy,
      };
    });
}
function layer(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw Error("This device cannot render player visibility.");
  return { canvas, ctx };
}
function polygon(
  ctx: CanvasRenderingContext2D,
  points: ScenePoint[],
  width: number,
  height: number,
) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (const p of points.slice(1)) ctx.lineTo(p.x * width, p.y * height);
  ctx.closePath();
  ctx.fill();
}
export function visibilityMask(
  map: CampaignMap,
  settings: MapTabletop,
  viewers: VisionSource[],
  width: number,
  height: number,
) {
  const { canvas, ctx } = layer(width, height);
  ctx.fillStyle = "#fff";
  if (!settings.fog.enabled || settings.fog.base === "revealed") ctx.fillRect(0, 0, width, height);
  if (settings.fog.enabled)
    for (const shape of settings.fog.shapes) {
      ctx.globalCompositeOperation = shape.reveal ? "source-over" : "destination-out";
      if (shape.kind === "polygon") polygon(ctx, shape.points, width, height);
      else if (shape.kind === "brush") {
        ctx.save();
        ctx.scale(width, height);
        ctx.lineWidth = shape.radius * 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (const p of shape.points.slice(1)) ctx.lineTo(p.x, p.y);
        if (shape.points.length === 1) {
          ctx.arc(shape.points[0].x, shape.points[0].y, shape.radius, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.stroke();
        ctx.restore();
      } else {
        const x = Math.min(shape.a.x, shape.b.x) * width,
          y = Math.min(shape.a.y, shape.b.y) * height,
          w = Math.abs(shape.a.x - shape.b.x) * width,
          h = Math.abs(shape.a.y - shape.b.y) * height;
        if (shape.kind === "rectangle") ctx.fillRect(x, y, w, h);
        else {
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  if (settings.vision !== "off") {
    const vision = layer(width, height),
      lights = layer(width, height),
      dark = layer(width, height);
    for (const source of viewers) {
      polygon(
        vision.ctx,
        visionPolygon(source.point, source.rangeFeet, map, settings),
        width,
        height,
      );
      if (source.darkvisionFeet)
        polygon(
          dark.ctx,
          visionPolygon(source.point, source.darkvisionFeet, map, settings),
          width,
          height,
        );
    }
    if (!settings.ambientLight) {
      for (const light of settings.lights.filter((light) => light.visible))
        polygon(
          lights.ctx,
          visionPolygon(light.at, light.radiusFeet, map, settings),
          width,
          height,
        );
      vision.ctx.globalCompositeOperation = "destination-in";
      vision.ctx.drawImage(lights.canvas, 0, 0);
    }
    vision.ctx.globalCompositeOperation = "source-over";
    vision.ctx.drawImage(dark.canvas, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(vision.canvas, 0, 0);
  }
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}
/** Hidden source RGBA is zeroed before encoding. No source pixels are sent behind a CSS overlay. */
export async function renderMapVisibility(
  source: ImageBitmap,
  map: CampaignMap,
  settings: MapTabletop,
  viewers: VisionSource[],
) {
  if (source.width > 8192 || source.height > 8192 || source.width * source.height > 64_000_000)
    throw Error("The decoded map exceeds supported dimensions.");
  const scale = Math.min(1, 4096 / Math.max(source.width, source.height)),
    width = Math.max(1, Math.round(source.width * scale)),
    height = Math.max(1, Math.round(source.height * scale));
  const { canvas, ctx } = layer(width, height),
    mask = visibilityMask(map, settings, viewers, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height),
    alpha = mask.getContext("2d")!.getImageData(0, 0, width, height).data;
  for (let i = 0; i < pixels.data.length; i += 4)
    if (alpha[i + 3] !== 255) pixels.data.fill(0, i, i + 4);
  ctx.putImageData(pixels, 0, 0);
  return bundleMapAsset(
    await canvasBlob(canvas),
    width,
    height,
    mapThumbnail(canvas, width, height),
    "render",
  );
}
