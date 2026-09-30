import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";

const OFFER = "quire.guide.offer.v2";

const sections: Array<{ title: string; body: string; points?: Array<{ label: string; body: string }> }> = [
  {
    title: "Desk",
    body: "The home page shows the money on hand, the value of items and property, the current price modifiers, and recent purchases, sales, and payments. Download copy saves this campaign to a file. Restore copy replaces it.",
  },
  {
    title: "Market",
    body: "Each shop has an owner, a location, and a list of items. At the counter, pick who is paying and buy. The shop charges its sell rate. It pays its buy rate when someone sells an item back. Edit changes the name, the rates, and the stock. A blank quantity means the shop does not run out.",
  },
  {
    title: "Create a shop",
    body: "Create a shop builds one from the index. Choose the type, how wealthy it is, and whether it stocks common, uncommon, rare, or magic items. A poor shop stocks basics and charges less. A wealthy shop charges more and keeps rarer items. Shuffle picks a new name, owner, location, and stock.",
  },
  {
    title: "Index",
    body: "The index is the list of items and names. Add an item yourself, generate a batch, or copy priced lines and names from a PDF you imported. A shop can only stock items that are in the index. Nothing is uploaded.",
  },
  {
    title: "Party",
    body: "The party purse is the group's shared money. A character purse belongs to one person. Mark each character as Player or NPC. Only player characters get a link on the Share tab. Set the coins, or use Make change so 10 copper becomes 1 silver, 10 silver becomes 1 gold, and 10 gold becomes 1 platinum. Electrum is half a gold piece. Holdings are items and property. A payment adds a ledger line without using a shop.",
  },
  {
    title: "Player and dungeon master",
    body: "The link sets the role. The label at the top shows which one this phone is. There is no live connection. The last link this phone opened is the role it keeps.",
    points: [
      {
        label: "Player link",
        body: "Copy it from the Share tab for one character. Turn party fund on if that player may spend the shared purse, then copy the link. The phone that opens it becomes a player for that character only. They cannot change prices, the index, anyone else's money, or which campaign is open.",
      },
      {
        label: "Dungeon master",
        body: "Opening the app normally makes the phone the dungeon master. Leave player mode does the same for a phone that opened a player link. It does not send your campaign.",
      },
      {
        label: "Bill link",
        body: "The player copies this when they are done. It includes every purchase on that phone. The phone that opens it becomes the dungeon master, and a popup lists what was bought and who paid. If both sides still have an item, the lower quantity is kept.",
      },
    ],
  },
  {
    title: "Prices",
    body: "Settings changes prices. Season, shortage, war, plague, and road conditions affect the categories they apply to. Scarcity raises rare and magic prices. Inflation raises every price. One gold piece is shown as a dollar amount, $250 unless you change it. That does not convert the coins. Turn on repricing if open shops should update. Otherwise only shops you create later use the new prices.",
  },
  {
    title: "PDFs",
    body: "Import a PDF you already own. It stays on this device and is split into entries you can search and save. You can copy names into the index, or copy printed prices onto a shop. Only lines that look like items are offered. You choose what to keep.",
  },
  {
    title: "Campaigns",
    body: "The dungeon master can keep more than one campaign. Each has its own shops, money, index, names, and PDFs. Open switches which one the app is using. A new campaign starts with the starter data. Removing one deletes only that campaign. A player link cannot create, rename, open, or delete campaigns.",
  },
  {
    title: "On this device",
    body: "Colors, light and dark mode, and reading options are in Settings. Reset prices returns the modifiers to their defaults. Reset everything returns this campaign to the starter data. Other campaigns are not changed. Nothing is uploaded.",
  },
];

export function Guide() {
  const [ask, setAsk] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(OFFER)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dawn = window.sessionStorage.getItem("quire.dawn.v1");
    const wait = !reduced && !dawn ? 1500 : 250;
    const handle = window.setTimeout(() => {
      if (!window.localStorage.getItem(OFFER)) setAsk(true);
    }, wait);
    return () => window.clearTimeout(handle);
  }, []);

  const choosing = useRef(false);

  function answer(view: boolean) {
    choosing.current = true;
    window.localStorage.setItem(OFFER, view ? "yes" : "no");
    setAsk(false);
    if (view) setOpen(true);
  }

  return (
    <>
      <button type="button" className="mt-3 inline-flex min-h-11 items-center text-sm text-muted" onClick={() => setOpen(true)}>
        How Lootsplit works
      </button>
      <Modal open={ask} onOpenChange={(next) => {
        if (next || choosing.current) {
          choosing.current = false;
          return;
        }
        answer(false);
      }} title="View the instructions?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            By default the desk opens and you can use the app. The instructions are optional. No skips them. Yes shows them now. How Lootsplit works on the desk opens them later either way.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => answer(false)}>No</Button>
            <Button onClick={() => answer(true)}>Yes</Button>
          </div>
        </div>
      </Modal>
      <Modal open={open} onOpenChange={setOpen} title="How Lootsplit works">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Lootsplit tracks money, shops, and prices for a campaign. It runs on this device. Nothing is uploaded.
          </p>
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-xl tracking-tight">{section.title}</h2>
              <p className="mt-1 text-sm text-muted">{section.body}</p>
              {section.points ? (
                <ul className="mt-2 flex flex-col gap-2">
                  {section.points.map((point) => (
                    <li key={point.label} className="text-sm text-muted">
                      <span className="text-fg">{point.label}. </span>
                      {point.body}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          <Button onClick={() => setOpen(false)}>Close</Button>
        </div>
      </Modal>
    </>
  );
}
