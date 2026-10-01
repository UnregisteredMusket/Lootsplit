import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button, TextArea } from "@/components/ui";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import {
  getChatSnapshot,
  postNotes,
  refreshChat,
  serverChat,
  subscribeChat,
  loadNotes,
  type ChatNote,
} from "@/lib/quire/chat";
import { getCloudTable, subscribeCloudTable, queueCommand } from "@/lib/quire/cloud-client";
import { snapshot } from "@/lib/quire/economy";
import { loadGifts } from "@/lib/quire/gift";
import { loadLoans, loadSales } from "@/lib/quire/market";
import { loadSheets } from "@/lib/quire/sheet";
import { buildBill, copyText, encodeLinkPayload, seatHref } from "@/lib/quire/table";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { characterControl } from "@/lib/quire/types";

export function ManualChat() {
  const seat = useSeat();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getCloudTable);
  const { purses } = useEconomy();
  const { activeId } = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const notes = useSyncExternalStore(subscribeChat, getChatSnapshot, serverChat);
  useEffect(() => {
    void refreshChat();
  }, [activeId]);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [audience, setAudience] = useState<"party" | "players">("players");
  const [playerTo, setPlayerTo] = useState<"dm" | "party">("dm");
  const [busy, setBusy] = useState(false);
  const player = seat.role === "player";
  const characters = purses.filter(
    (purse) => purse.kind === "character" && characterControl(purse) !== "npc",
  );
  const mine = player ? characters.filter((purse) => seat.purseIds.includes(purse.id)) : characters;
  const names = new Map(purses.map((purse) => [purse.id, purse.name]));
  const partyNotes = notes.filter((note) => note.to === "party");
  const privateNotes = notes.filter(
    (note) =>
      note.to === "dm" &&
      (player
        ? seat.purseIds.includes(note.purseId)
        : mine.some((purse) => purse.id === note.purseId)),
  );
  const selected = mine.filter((purse) => picked[purse.id] !== false);

  async function send() {
    const body = text.trim();
    if (!body) return;
    const toParty = player ? playerTo === "party" : audience === "party";
    const targets = toParty
      ? [player ? (mine[0]?.id ?? "") : ""]
      : player
        ? mine.map((purse) => purse.id).slice(0, 1)
        : selected.map((purse) => purse.id);
    if (player && mine.length === 0) {
      toast("This link has no character to write for.");
      return;
    }
    if (!toParty && targets.length === 0) {
      toast(player ? "This link has no character to write for." : "Choose at least one player.");
      return;
    }
    setBusy(true);
    try {
      if (cloud.joined) {
        for (const purseId of targets)
          await queueCommand({
            kind: "message",
            to: toParty ? "party" : "dm",
            purseId,
            text: body,
          });
      } else
        await postNotes(
          targets.map((purseId) => ({
            from: player ? "player" : "dm",
            to: toParty ? "party" : "dm",
            purseId,
            text: body,
          })),
        );
      setText("");
      toast.success(
        cloud.joined
          ? "Message shared."
          : player
            ? "Message saved. Share your activity report link or file with the DM."
            : "Message saved. Share updated player links or files with the recipients.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted">
        {cloud.joined
          ? cloud.live
            ? "Write to the DM or party. Messages sync through the shared campaign."
            : "Write to the DM or party. Messages are shared immediately, independently of transaction turns."
          : player
            ? "Save a message for the DM or party, then share your activity report link or file with the DM. Party messages reach other players through their updated links or files."
            : "Save a message for the party or selected players, then share updated player links or files. Replies arrive when you import player activity."}
      </p>
      <Thread
        title="Party"
        notes={partyNotes}
        names={names}
        empty="No one has written to the party."
      />
      {player ? (
        <Thread
          title="Dungeon master"
          notes={privateNotes}
          names={names}
          empty="No private messages."
        />
      ) : (
        <section className="mt-4">
          <h2 className="text-sm font-medium">Dungeon master</h2>
          {privateNotes.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No private messages.</p>
          ) : null}
          <ul className="mt-2 flex flex-col gap-3">
            {mine.map((purse) => {
              const thread = privateNotes.filter((note) => note.purseId === purse.id);
              if (thread.length === 0) return null;
              return (
                <li key={purse.id}>
                  {mine.length > 1 ? <p className="text-sm font-medium">{purse.name}</p> : null}
                  <NoteList notes={thread} names={names} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium">Send to</legend>
        {player ? (
          <>
            <Radio
              name="player-to"
              label="Dungeon master"
              checked={playerTo === "dm"}
              onChange={() => setPlayerTo("dm")}
            />
            <Radio
              name="player-to"
              label="Party"
              checked={playerTo === "party"}
              onChange={() => setPlayerTo("party")}
            />
          </>
        ) : (
          <>
            <Radio
              name="dm-to"
              label="Party"
              checked={audience === "party"}
              onChange={() => setAudience("party")}
            />
            <Radio
              name="dm-to"
              label="Selected players"
              checked={audience === "players"}
              onChange={() => setAudience("players")}
            />
            {audience === "players" && mine.length > 1 ? (
              <div className="mt-1 pl-1">
                <Choice
                  label="All players"
                  checked={selected.length === mine.length}
                  onChange={() => {
                    const on = selected.length !== mine.length;
                    setPicked(Object.fromEntries(mine.map((purse) => [purse.id, on])));
                  }}
                />
                {mine.map((purse) => (
                  <Choice
                    key={purse.id}
                    label={purse.name}
                    checked={picked[purse.id] !== false}
                    onChange={() =>
                      setPicked((current) => ({
                        ...current,
                        [purse.id]: current[purse.id] === false,
                      }))
                    }
                  />
                ))}
              </div>
            ) : null}
            {audience === "players" && mine.length === 1 ? (
              <p className="text-sm text-muted">{mine[0]?.name}</p>
            ) : null}
          </>
        )}
      </fieldset>
      <label className="mt-4 block text-sm text-muted">
        Message
        <TextArea
          className="mt-1"
          maxLength={500}
          value={text}
          placeholder="Write a message"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <Button
        className="mt-2"
        disabled={busy || text.trim().length === 0}
        onClick={() => void send()}
      >
        {cloud.joined
          ? "Save message"
          : sendLabel(
              player,
              player ? playerTo === "party" : audience === "party",
              selected.length,
            )}
      </Button>
      {player && !cloud.joined ? (
        <div className="mt-3">
          <p className="text-sm text-muted">
            Not sent yet. A message or a gift stays in this browser on this device until you send
            the activity report.
          </p>
          <Button
            className="mt-2"
            variant="secondary"
            onClick={() => {
              void (async () => {
                const file = await snapshot();
                const gifts = await loadGifts();
                const bill = buildBill(
                  {
                    ...file,
                    notes: await loadNotes(),
                    gifts,
                    loans: await loadLoans(),
                    sales: await loadSales(),
                    sheets: await loadSheets(),
                  },
                  seat,
                );
                const payload = await encodeLinkPayload(bill);
                const url = seatHref("dm", payload, window.location.origin);
                if (url.length > 48000)
                  throw new Error(
                    "This activity report is too long for a link. Download it from Share.",
                  );
                await copyText(url);

                toast.success("Activity report link copied. The dungeon master opens it.");
              })().catch((error: unknown) =>
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not copy the activity report link.",
                ),
              );
            }}
          >
            Copy report link
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function sendLabel(player: boolean, party: boolean, count: number) {
  if (party) return "Save message for the party";
  if (player) return "Save message for the DM";
  return count > 1 ? "Save message for selected players" : "Save message";
}

function Choice({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm">
      <input
        type="checkbox"
        className="size-5 accent-accent"
        checked={checked}
        onChange={onChange}
      />
      {label}
    </label>
  );
}

function Radio({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm">
      <input
        type="radio"
        name={name}
        className="size-5 accent-accent"
        checked={checked}
        onChange={onChange}
      />
      {label}
    </label>
  );
}

function Thread({
  title,
  notes,
  names,
  empty,
}: {
  title: string;
  notes: ChatNote[];
  names: Map<string, string>;
  empty: string;
}) {
  return (
    <section className="mt-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {notes.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      ) : (
        <NoteList notes={notes} names={names} />
      )}
    </section>
  );
}

function NoteList({ notes, names }: { notes: ChatNote[]; names: Map<string, string> }) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-sm border border-border px-3 py-2">
          <p className="text-xs font-medium tracking-wide text-faint uppercase">
            {speaker(note, names)}
          </p>
          <p className="mt-1 text-sm">{note.text}</p>
        </li>
      ))}
    </ul>
  );
}

function speaker(note: ChatNote, names: Map<string, string>) {
  if (note.from === "dm") return "Dungeon master";
  return names.get(note.purseId) ?? "Player";
}
