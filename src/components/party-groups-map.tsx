import type { CloudTable } from "@/lib/quire/cloud";
import { groupInfo } from "@/lib/quire/party-groups";
import { GroupBadge } from "./party-groups";

/** Here: which group's place to list (map.html "Here · one sheet per group"). */
export function HereGroupSwitch({
  table,
  groups,
  value,
  onChange,
}: {
  table: Pick<CloudTable, "journal">;
  groups: string[];
  value?: string;
  onChange: (group: string) => void;
}) {
  return (
    <div className="ghere-switch" role="group" aria-label="Whose place">
      {groups.map((g) => {
        const info = groupInfo(table, g);
        return (
          <button type="button" key={g} className={`g-${info.colour}`} aria-pressed={value === g} onClick={() => onChange(g)}>
            <GroupBadge letter={info.letter} colour={info.colour} />
            <span>{info.name}</span>
          </button>
        );
      })}
    </div>
  );
}
