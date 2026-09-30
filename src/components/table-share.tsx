import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { characterControl } from "@/lib/quire/types";
import { useSeat } from "@/lib/quire/seat";
import { buildBill, buildTable, copyText, DM_SEAT, downloadJson, encodeLinkPayload, seatHref, setSeat } from "@/lib/quire/table";
import { snapshot } from "@/lib/quire/economy";
import { Button, Confirm, Switch } from "@/components/ui";

export function TableShare() {
  const { shops, stock, purses, holdings, realm } = useEconomy();
  const [shopOn, setShopOn] = useState<Record<string, boolean>>({});
  const [partyOn, setPartyOn] = useState<Record<string, boolean>>({});
  const characters = purses.filter((purse) => purse.kind === "character" && characterControl(purse) !== "npc");
  const npcs = purses.filter((purse) => characterControl(purse) === "npc");
  const parties = purses.filter((purse) => purse.kind === "party");

  useEffect(() => {
    setShopOn((current) => {
      const next = { ...current };
      for (const shop of shops) {
        if (next[shop.id] === undefined) next[shop.id] = true;
      }
      return next;
    });
  }, [shops]);

  function pickedShops() {
    return shops.filter((shop) => shopOn[shop.id]);
  }

  function pursesFor(characterId: string) {
    const character = characters.find((purse) => purse.id === characterId);
    if (!character) return [];
    return partyOn[characterId] ? [...parties, character] : [character];
  }

  function tableFor(characterId: string) {
    const chosenShops = pickedShops();
    const chosenPurses = pursesFor(characterId);
    if (chosenShops.length === 0 || chosenPurses.length === 0) return null;
    return buildTable({ realm, shops: chosenShops, stock, purses: chosenPurses, holdings });
  }

  async function copyPlayerLink(characterId: string, name: string) {
    const file = tableFor(characterId);
    if (!file) {
      toast("Choose at least one shop.");
      return;
    }
    const payload = await encodeLinkPayload(file);
    const url = seatHref("player", payload, window.location.origin);
    if (url.length > 48000) {
      toast.error("That shop list is too long for a link. Download the file instead.");
      return;
    }
    await copyText(url);
    toast.success(`${name}'s link copied.`);
  }

  function downloadPlayerFile(characterId: string, name: string) {
    const file = tableFor(characterId);
    if (!file) {
      toast("Choose at least one shop.");
      return;
    }
    downloadJson(`lootsplit-${name.replace(/\s+/g, "-").toLowerCase()}.json`, file);
    toast.success(`${name}'s file saved.`);
  }

  return (
    <div>
      <p className="max-w-prose text-sm text-muted">
        Each player gets their own link. Turn party fund on or off, then copy that player's link. The phone that opens it can buy only for that character, plus the shared purse if you left the switch on.
      </p>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium">Shops they can buy from</legend>
        <div className="flex flex-col gap-2">
          {shops.map((shop) => (
            <label key={shop.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-accent"
                checked={Boolean(shopOn[shop.id])}
                onChange={() => setShopOn((current) => ({ ...current, [shop.id]: !current[shop.id] }))}
              />
              {shop.name}
            </label>
          ))}
        </div>
      </fieldset>
      {characters.length === 0 ? <p className="mt-4 text-sm text-muted">Mark a character as Player on the Party page, then copy their link.</p> : null}
      {npcs.length > 0 ? (
        <p className="mt-3 text-sm text-muted">NPCs do not get a link: {npcs.map((purse) => purse.name).join(", ")}.</p>
      ) : null}
      <ul className="mt-4 flex flex-col gap-4">
        {characters.map((character) => (
          <li key={character.id} className="rounded-lg border border-border p-3">
            <p className="font-medium">{character.name}</p>
            {parties.length > 0 ? (
              <Switch
                label="Can spend the party fund"
                hint="Off means this player can spend only their own coins."
                checked={Boolean(partyOn[character.id])}
                onChange={(checked) => setPartyOn((current) => ({ ...current, [character.id]: checked }))}
              />
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void copyPlayerLink(character.id, character.name).catch(() => toast.error("Could not copy the link."))}>
                Copy link
              </Button>
              <Button variant="secondary" onClick={() => downloadPlayerFile(character.id, character.name)}>
                Download file
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TableDesk() {
  const seat = useSeat();
  const { openCounter, takeBill, sendBill } = useEconomy();
  const [leaving, setLeaving] = useState(false);

  async function read(file: File | undefined, kind: "counter" | "bill") {
    if (!file) return;
    try {
      if (kind === "counter") await openCounter(file);
      else await takeBill(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That file could not be read.");
    }
  }

  if (seat.role === "player") {
    return (
      <div>
        <p className="text-sm text-muted">
          Buy and sell with a character, or with the party purse. Copy the group bill when you are done. It lists every purchase on this phone and who paid.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void (async () => {
                const payload = await encodeLinkPayload(buildBill(await snapshot(), seat));
                const url = seatHref("dm", payload, window.location.origin);
                if (url.length > 48000) {
                  toast.error("This bill is too long for a link. Send the file.");
                  return;
                }
                await copyText(url);
                toast.success("Group bill copied. The phone that opens it becomes the dungeon master and shows who bought what.");
              })().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not copy the bill link."));
            }}
          >
            Copy group bill
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void sendBill()
                .then(() => toast.success("Group bill saved. Send that file if the link is inconvenient."))
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not write the bill."));
            }}
          >
            Download group bill
          </Button>
          <Button variant="secondary" onClick={() => setLeaving(true)}>
            Leave player mode
          </Button>
        </div>
        <Confirm
          open={leaving}
          onOpenChange={setLeaving}
          title="Leave player mode?"
          body="This phone becomes a dungeon master again for the data already on it. The dungeon master's original campaign is not changed."
          confirmLabel="Leave"
          onConfirm={() => setSeat(DM_SEAT)}
        />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted">
        Open a player file on this phone, or take a bill a player sent. A bill lists what was bought and who paid. If both sides still have an item, the lower quantity is kept.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-border px-4 text-sm">
          Open a player file
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              void read(event.target.files?.[0], "counter");
              event.target.value = "";
            }}
          />
        </label>
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-border px-4 text-sm">
          Take a bill
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              void read(event.target.files?.[0], "bill");
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}
