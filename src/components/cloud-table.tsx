import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  chooseTableMode,
  endTableTurn,
  getCloudTable,
  joinTable,
  lookupTable,
  resumeTable,
  skipTableTurn,
  subscribeCloudTable,
  manageParticipant,
} from "@/lib/quire/cloud-client";
import { useSeat } from "@/lib/quire/seat";
import { Button, ChoiceGrid, TextInput, Confirm } from "@/components/ui";

const EMPTY = getCloudTable();
type Mode = "local" | "turns" | "live";

const MODES: { value: Mode; label: string }[] = [
  { value: "local", label: "Local Mode" },
  { value: "turns", label: "Turn-based Mode" },
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
  const [joining, setJoining] = useState(false);
  const [nextMode, setNextMode] = useState<Mode | null>(null);
  const [release, setRelease] = useState<string | null>(null);
  const mode: Mode = !cloud.joined ? "local" : cloud.live ? "live" : "turns";

  useEffect(() => resumeTable(), []);

  function run(work: () => Promise<void>, ok?: string) {
    setBusy(true);
    void work()
      .then(() => {
        if (ok) toast.success(ok);
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "The table could not be reached."),
      )
      .finally(() => setBusy(false));
  }

  if (seat.role === "dm" && !joining) {
    return (
      <div>
        <ChoiceGrid
          label="Control panel"
          value={mode}
          options={MODES}
          onChange={(next) => {
            if (next === mode || busy) return;
            const note =
              next === "local"
                ? "Local Mode."
                : next === "turns"
                  ? "Turn-based Mode. Share this code with your players."
                  : "Live Mode. Share this code with your players.";
            if (cloud.joined) setNextMode(next);
            else run(() => chooseTableMode(next), note);
          }}
        />
        <p className="mt-3 text-sm text-muted">{modeNote(mode)}</p>
        {!cloud.joined ? (
          <Button variant="secondary" onClick={() => setJoining(true)}>
            Join an existing campaign as a player
          </Button>
        ) : null}
        <Confirm
          open={nextMode !== null}
          onOpenChange={(open) => {
            if (!open) setNextMode(null);
          }}
          title="Change sharing mode?"
          body="All participants must submit or discard pending transactions first. Returning to Local Mode closes the shared room and invalidates its code. Each device keeps its last synchronized copy."
          confirmLabel="Change mode"
          onConfirm={() => {
            const mode = nextMode;
            setNextMode(null);
            if (mode) run(() => chooseTableMode(mode));
          }}
        />
        <Confirm
          open={release !== null}
          onOpenChange={(open) => {
            if (!open) setRelease(null);
          }}
          title="Release this character?"
          body="The participant's old connection will stop working. They can join again with the campaign code. Pending actions must be resolved first."
          confirmLabel="Release character"
          onConfirm={() => {
            const id = release;
            setRelease(null);
            if (id) run(() => manageParticipant("release", id));
          }}
        />
        {mode === "local" ? null : (
          <>
            <p className="mt-3 text-sm">
              Code <span className="font-medium text-fg">{cloud.code}</span>
              {mode === "turns"
                ? cloud.mine
                  ? " · It is your turn."
                  : ` · Waiting for ${cloud.who}.`
                : " · Everyone can act."}
            </p>
            <ul className="mt-2 text-sm text-muted">
              {cloud.seats.map((item) => (
                <li key={item.id} className="border-b border-border py-2">
                  <p>
                    {item.role === "dm" ? "Dungeon master" : item.name}
                    {item.pending ? ` · ${item.pending} pending` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {!cloud.live ? (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => run(() => manageParticipant("start", item.id))}
                      >
                        Make current
                      </Button>
                    ) : null}
                    {item.role === "player" ? (
                      <>
                        <label className="flex min-h-11 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={item.allowParty}
                            disabled={busy}
                            onChange={(e) =>
                              run(() => manageParticipant("permission", item.id, e.target.checked))
                            }
                          />
                          Allow party fund
                        </label>
                        <Button variant="ghost" onClick={() => setRelease(item.id)}>
                          Release character
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {mode === "turns" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {cloud.mine ? (
                  <Button disabled={busy} onClick={() => run(() => endTableTurn(), "Turn ended.")}>
                    Submit changes and end turn
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(() => skipTableTurn(), "Turn skipped.")}
                  >
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
        {joining ? (
          <Button variant="ghost" onClick={() => setJoining(false)}>
            Cancel joining
          </Button>
        ) : null}
        <p className="text-sm text-muted">
          Local Mode. This browser keeps its own campaign. When the dungeon master opens Turn-based
          Mode or Live Mode, enter the code.
        </p>
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              const found = await lookupTable(code);
              setCharacters(found.characters);
              setPurseId(found.characters[0]?.id ?? "");
              if (found.characters.length === 0)
                toast("All available characters have been assigned.");
            });
          }}
        >
          <TextInput
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Table code"
            aria-label="Table code"
          />
          <Button type="submit" variant="secondary" disabled={busy || code.trim().length < 4}>
            Find characters
          </Button>
        </form>
        {characters.length > 0 ? (
          <form
            className="mt-4 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => joinTable(code, purseId, name), "You joined the campaign.");
            }}
          >
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              aria-label="Your name"
            />
            <select
              value={purseId}
              onChange={(event) => setPurseId(event.target.value)}
              className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
              aria-label="Character"
            >
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={busy || !purseId}>
              Join campaign
            </Button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium">{mode === "live" ? "Live Mode" : "Turn-based Mode"}</p>
      <p className="mt-2 text-sm text-muted">
        Code <span className="font-medium text-fg">{cloud.code}</span>.{" "}
        {mode === "live"
          ? "Everyone can act."
          : cloud.mine
            ? "It is your turn."
            : `Waiting for ${cloud.who}.`}
      </p>
      {mode === "turns" && cloud.mine ? (
        <div className="mt-4">
          <Button disabled={busy} onClick={() => run(() => endTableTurn(), "Turn ended.")}>
            Submit changes and end turn
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function modeNote(mode: Mode): string {
  if (mode === "turns")
    return "One shared campaign. Only the person whose turn it is can change it. Use Local Mode for manual sharing with links and files.";
  if (mode === "live")
    return "One shared campaign. Everyone can act at the same time. Use Local Mode for manual sharing with links and files.";
  return "Each browser stores a separate campaign. Copy a player link or download a player file, then share it yourself. Player changes return through an activity report.";
}
