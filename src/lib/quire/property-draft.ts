import { propertyProfileSchema, type PropertyProfile } from "./property.ts";

export function propertyDraft(profile?: PropertyProfile) {
  return {
    type: profile?.type ?? "other",
    condition: profile?.condition ?? "",
    rooms: profile?.rooms === undefined ? "" : String(profile.rooms),
    size: profile?.size ?? "",
    address: profile?.address ?? "",
    seller: profile?.seller ?? "",
    features: (profile?.features ?? []).join(", "),
    images: [...(profile?.images ?? [])],
  };
}
export type PropertyDraft = ReturnType<typeof propertyDraft>;
export function readPropertyDraft(draft: PropertyDraft): PropertyProfile {
  return propertyProfileSchema.parse({
    type: draft.type,
    ...(draft.condition ? { condition: draft.condition } : {}),
    ...(draft.rooms.trim() ? { rooms: Number(draft.rooms) } : {}),
    ...(draft.size.trim() ? { size: draft.size.trim() } : {}),
    ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
    ...(draft.seller.trim() ? { seller: draft.seller.trim() } : {}),
    features: [
      ...new Set(
        draft.features
          .split(",")
          .map((feature) => feature.trim())
          .filter(Boolean),
      ),
    ],
    images: draft.images.filter(Boolean),
  });
}
