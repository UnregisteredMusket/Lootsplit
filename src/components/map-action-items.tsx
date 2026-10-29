import type { ReactNode } from "react";
import {
  Crosshair,
  DoorOpen,
  Eye,
  EyeOff,
  Footprints,
  Lightbulb,
  ListMinus,
  ListPlus,
  Lock,
  LockOpen,
  MapPin,
  Maximize2,
  MousePointer2,
  Move,
  Radio,
  Ruler,
  ScrollText,
  Send,
  Share2,
  Shapes,
  Skull,
  Store,
  Swords,
  Trash2,
  UserRound,
  Users,
  Waypoints,
} from "lucide-react";
import type { MapActionId, MapActionList } from "@/lib/quire/map-actions";
import type { MapAction, MapActionGroup, MapActionMenu } from "./map-context-menu";

const icon = (Icon: typeof Swords) => <Icon size={16} />;
/** Icons for the map menu (the mockup's glyphs, from the icon set the app already uses). */
export const MAP_ACTION_ICONS: Record<MapActionId, ReactNode> = {
  "start-encounter": icon(Swords),
  "add-creatures": icon(Skull),
  "add-characters": icon(Users),
  "place-party": icon(Shapes),
  "place-selected": icon(MousePointer2),
  "move-party": icon(Send),
  "party-position": icon(Waypoints),
  "place-record": icon(Store),
  marker: icon(MapPin),
  entrance: icon(DoorOpen),
  ping: icon(Radio),
  measure: icon(Ruler),
  "share-view": icon(Share2),
  reveal: icon(Eye),
  light: icon(Lightbulb),
  "place-mine": icon(Footprints),
  "open-tracker": icon(ScrollText),
  "open-sheet": icon(ScrollText),
  "move-to": icon(Move),
  hide: icon(EyeOff),
  show: icon(Eye),
  lock: icon(Lock),
  unlock: icon(LockOpen),
  "add-initiative": icon(ListPlus),
  "remove-combat": icon(ListMinus),
  size: icon(Maximize2),
  controllers: icon(UserRound),
  "send-to": icon(Send),
  remove: icon(Trash2),
  "my-sheet": icon(ScrollText),
  centre: icon(Crosshair),
};

/** The rendered menu: each item gets its icon, its action, and its submenu when it has one. */
export function menuFromActions(
  list: MapActionList,
  run: Partial<Record<MapActionId, () => void>>,
  submenus: Partial<Record<MapActionId, { title?: string; groups: MapActionGroup[] }>> = {},
): MapActionMenu {
  return {
    title: list.title,
    subtitle: list.subtitle,
    groups: list.sections.map((section) => ({
      label: section.label,
      items: section.items.map(
        (spec): MapAction => ({
          ...spec,
          icon: MAP_ACTION_ICONS[spec.id],
          run: run[spec.id],
          submenu: spec.submenu ? submenus[spec.id] : undefined,
          // An item with no handler here (or an empty submenu) is shown unavailable.
          disabled: spec.disabled || (spec.submenu ? !submenus[spec.id]?.groups.some((g) => g.items.length) : !run[spec.id]),
        }),
      ),
    })),
  };
}
