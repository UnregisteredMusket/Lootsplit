import {
  Flag,
  EyeOff,
  House,
  Mail,
  MapPin,
  Ship as ShipIcon,
  Store,
  Swords,
  UserRound,
  Users,
} from "lucide-react";

/** The round map icon for a record kind (shared by pins and place cards). */
export function RecordIcon({ kind }: { kind: string }) {
  const Icon =
    kind === "Ship"
      ? ShipIcon
      : kind === "Combatant"
        ? Swords
        : kind === "NPC" || kind === "Character"
          ? UserRound
          : kind === "Party"
            ? Users
            : kind === "Shop"
              ? Store
              : kind === "Black market"
                ? EyeOff
                : kind === "Property"
                  ? House
                  : kind === "Post office"
                    ? Mail
                    : kind === "Marker"
                      ? Flag
                      : MapPin;
  return <Icon size={18} aria-hidden="true" />;
}
