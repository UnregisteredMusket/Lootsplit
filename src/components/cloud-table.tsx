import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { chooseTableMode, endTableTurn, getCloudTable, joinTable, lookupTable, resumeTable, skipTableTurn, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useSeat } from "@/lib/quire/seat";
import { Button, ChoiceGrid, TextInput } from "@/components/ui";

const EMPTY = { joined: false, mine: true, live: false, who: "", code: "", role: "dm" as const, seats: [] as { name: string; role: "dm" | "player" }[], revision: 0 };
type Mode = "local" | "turns" | "live";

const MODES: { value: Mode; label: string }[] = [
  { value: "local", label: "Local Mode" },
  { value: "turns", label: "Turn based Mode" },
  { value: "live", label: "Live Mode" },
];

export function CloudTable() {
  const seat = useSeat();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, () => EMPTY);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [characters, setCharacters] = useState<{ id: string; name: string }[]>([]);
  const [purseId, setPurseId] = useState("");
  const [busy, setBusy] = useState(false);
  const mode: Mode = !cloud.joined ? "local" : cloud.live ? "live" : "turns";

  useEffect(() => resumeTable(), []);

  function run(work: () => Promise<void>, ok?: string) {
    setBusy(true);
    void work()
      .then(() => { if (ok) toast.success(ok); })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The table could not be reached."))
      .finally(() => setBusy(false));
  }

  if (seat.role === "dm") {
    return (
      <div>
        <ChoiceGrid
          label="Control panel"
          value={mode}
          options={MODES}
          onChange={(next) => {
            if (next === mode || busy) return;
            const note = next === "local" ? "Local Mode." : next === "turns" ? "Turn based Mode. Read them the code." : "Live Mode. Read them the code.";
            run(() => chooseTableMode(next), note);
          }}
        />
        <p className="mt-3 text-sm text-muted">{modeNote(mode)}</p>
        {mode === "local" ? null : (
          <>
            <p className="mt-3 text-sm">
              Code <span className="font-medium text-fg">{cloud.code}</span>
              {mode === "turns" ? (cloud.mine ? " · It is your turn." : ` · Waiting for ${cloud.who}.`) : " · Everyone can act."}
            </p>
            <ul className="mt-2 text-sm text-muted">
              {cloud.seats.map((item) => (
                <li key={`${item.role}-${item.name}`}>{item.role === "dm" ? "Dungeon master" : item.name}</li>
              ))}
            </ul>
            {mode === "turns" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {cloud.mine ? (
                  <Button disabled={busy} onClick={() => run(() => endTableTurn(), "Turn ended.")}>
                    End turn
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={busy} onClick={() => run(() => skipTableTurn(), "Turn skipped.")}>
                    Skip this turn
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  }

  if (!cloud.joined) {
    return (
      <div>
        <p className="text-sm text-muted">Local Mode. This phone keeps its own campaign. When the dungeon master opens Turn based Mode or Live Mode, enter the code.</p>
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              const found = await lookupTable(code);
              setCharacters(found.characters);
              setPurseId(found.characters[0]?.id ?? "");
              if (found.characters.length === 0) toast("Every character is already seated.");
            });
          }}
        >
          <TextInput value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Table code" aria-label="Table code" />
          <Button type="submit" variant="secondary" disabled={busy || code.trim().length < 4}>
            Find characters
          </Button>
        </form>
        {characters.length > 0 ? (
          <form
            className="mt-4 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => joinTable(code, purseId, name), "You are seated.");
            }}
          >
            <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" aria-label="Your name" />
            <select value={purseId} onChange={(event) => setPurseId(event.target.value)} className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg" aria-label="Character">
              {characters.map((character) => (
                <option key={character.id} value={character.id}>{character.name}</option>
              ))}
            </select>
            <Button type="submit" disabled={busy || !purseId}>Sit down</Button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium">{mode === "live" ? "Live Mode" : "Turn based Mode"}</p>
      <p className="mt-2 text-sm text-muted">
        Code <span className="font-medium text-fg">{cloud.code}</span>. {mode === "live" ? "Everyone can act." : cloud.mine ? "It is your turn." : `Waiting for ${cloud.who}.`}
      </p>
      {mode === "turns" && cloud.mine ? (
        <div className="mt-4">
          <Button disabled={busy} onClick={() => run(() => endTableTurn(), "Turn ended.")}>
            End turn
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function modeNote(mode: Mode): string {
  if (mode === "turns") return "One shared campaign. Only the person whose turn it is can change it. Links and files still work if the connection fails.";
  if (mode === "live") return "One shared campaign. Everyone can act at the same time. Links and files still work if the connection fails.";
  return "Each phone keeps its own campaign. Nothing is shared until you copy a link or hand someone a file.";
}