import { useEffect, useState } from "react";
import { getCloudTable } from "./cloud-client";
import { useEconomy } from "./economy-context";
import { loadRoster, type RosterPerson } from "./gift";
import { useSeat } from "./seat";
import { characterControl } from "./types";

/** Who a character can give to, the same list Give to a player offers. */
export function useGiveRecipients(fromId: string): {
  recipients: Array<{ id: string; name: string }>;
  rosterError: string;
} {
  const { purses: everyone } = useEconomy();
  const seat = useSeat();
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [rosterError, setRosterError] = useState("");
  useEffect(() => {
    if (seat.role !== "player") return;
    let cancelled = false;
    loadRoster().then(
      (people) => {
        if (cancelled) return;
        setRoster(people);
        setRosterError("");
      },
      (error: unknown) => {
        if (cancelled) return;
        setRosterError(
          error instanceof Error && error.message
            ? `The player list on this device could not be read: ${error.message}`
            : "The player list on this device could not be read.",
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [seat.role, everyone.length]);
  const recipients =
    seat.role === "dm"
      ? everyone.filter((purse) => purse.id !== fromId).map((purse) => ({ id: purse.id, name: purse.name }))
      : getCloudTable().joined
        ? everyone
            .filter(
              (purse) =>
                purse.id !== fromId &&
                purse.kind === "character" &&
                characterControl(purse) === "player",
            )
            .map((purse) => ({ id: purse.id, name: purse.name }))
        : roster.filter((person) => person.id !== fromId);
  return { recipients, rosterError };
}

