import { useEconomy } from "./economy-context";
import { useSeat } from "./seat";
import { seatGroups } from "./party-groups.ts";
/**
 * Split the party: the groups whose place counts as "here" for this seat (a player's groups; the
 * DM: every group). Just `["main"]` when the party is whole, which is today's single place.
 */
export function useSeatGroups(): string[] {
  const { purses, journal } = useEconomy();
  const seat = useSeat();
  return seatGroups({ purses, journal }, seat);
}
