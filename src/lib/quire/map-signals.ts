import { z } from "zod";
export const PING_DURATION = 5000;
export const pingColors = ["red", "amber", "green", "blue", "violet"] as const;
export const mapPingInput = z
  .object({
    id: z.string().uuid(),
    mapId: z.string().min(1).max(160),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    color: z.enum(pingColors),
  })
  .strict();
export const mapPingSchema = mapPingInput.extend({
  seatId: z.string().min(1),
  createdAt: z.number().finite(),
  expiresAt: z.number().finite(),
});
export type MapPingInput = z.infer<typeof mapPingInput>;
export type MapPing = z.infer<typeof mapPingSchema>;
export type MapRecord = {
  id: string;
  label: string;
  kind: string;
  point?: { x: number; y: number };
  href?: string;
  description?: string;
};
export const mapRecordKinds = [
  "Location",
  "Marker",
  "NPC",
  "Shop",
  "Black market",
  "Property",
  "Post office",
  "Party",
] as const;
/** Group by exact image position and type; each visible type keeps its own icon/count. */
export function groupMapRecords(records: MapRecord[], visible: readonly string[]) {
  const groups = new Map<
    string,
    { point: { x: number; y: number }; kinds: { kind: string; records: MapRecord[] }[] }
  >();
  for (const record of records) {
    if (!record.point || !visible.includes(record.kind)) continue;
    const key = `${record.point.x}:${record.point.y}`;
    let group = groups.get(key);
    if (!group) {
      group = { point: record.point, kinds: [] };
      groups.set(key, group);
    }
    let type = group.kinds.find((type) => type.kind === record.kind);
    if (!type) {
      type = { kind: record.kind, records: [] };
      group.kinds.push(type);
    }
    type.records.push(record);
  }
  return [...groups.entries()].map(([id, group]) => ({ id, ...group }));
}
