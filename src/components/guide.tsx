import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { APP_VERSION } from "@/lib/quire/version";

const OFFER = "quire.guide.offer.v3";

const sections: Array<{ title: string; body: string; points?: Array<{ label: string; body: string }> }> = [
  {
    title: "Two homes",
    body: "The dungeon master's first screen is the Board: the mode, notices, recent messages, the party, and a few settings. A player's first screen is their Sheet: the 2014 character sheet, the coin purse, and the inventory. The first tab is named for whichever one this phone is.",
  },
  {
    title: "Three modes",
    body: "The dungeon master changes the mode from the Board or from Share. The icon at the upper right shows which one is on.",
    points: [
      {
        label: "Local Mode",
        body: "The campaign stays on this phone. Players use a link or a file. Nothing is shared until a bill comes back.",
      },
      {
        label: "Turn based Mode",
        body: "One shared table. Read the players the code. Only the person whose turn it is can buy, sell, or change money. Ending a turn passes the table on.",
      },
      {
        label: "Live Mode",
        body: "The same shared table, but anyone seated can act. The dungeon master is the only one who can turn Live Mode on, and nobody can change roles while it is on.",
      },
    ],
  },
  {
    title: "Market",
    body: "Each shop has an owner, a location, and stock. At the counter, pick who is paying and buy. The shop charges its sell rate and pays its buy rate. A blank quantity means the shop does not run out. A character's Charisma lowers the price by one percent for each point above 10. The dungeon master can list property and other holdings, and can approve or refuse a loan a player requests.",
  },
  {
    title: "Index and shops",
    body: "The index is the list of items and names. Add an item, generate a batch, or copy priced lines from a PDF. A shop can only stock items that are in the index. Create a shop picks a type, a level of wealth, and which rarities to keep. Shuffle picks a new name, owner, location, and stock.",
  },
  {
    title: "Party",
    body: "A character purse belongs to one person. The party purse is shared money. Mark each character as Player or NPC. Only player characters can be put on a link. Import a 2014 character sheet from a filled PDF or a JSON export onto that character. Holdings are items and property. Players can give coins, items, or property to someone else at the table. Those gifts show in the party messages and in the dungeon master's bill.",
  },
  {
    title: "Share",
    body: "Players do not need Grok. They open the link in a browser. The link carries the characters you checked, and the shops you included.",
    points: [
      {
        label: "Messages",
        body: "A player can write to the dungeon master or to the party. The dungeon master can write to the party or to the players they check. In Local Mode the note travels with the next bill. In Turn based Mode and Live Mode it arrives with the table.",
      },
      {
        label: "Bill",
        body: "When a player's link or file is opened, a report lists every purchase, sale, gift, loan, and message from that phone. The report also says if that phone switched to dungeon master.",
      },
      {
        label: "Notices",
        body: "Turn notices on from Share or from Settings. This phone can then say when the mode changes, a message arrives, or it is your turn. That works only while Lootsplit is still open.",
      },
    ],
  },
  {
    title: "Role",
    body: "The name at the upper right is the role. Press it to change. Set a password in Settings first. Switching from dungeon master to player asks you to confirm. Switching back asks for that password. Live Mode blocks both. A bill records it if a player becomes the dungeon master.",
  },
  {
    title: "Prices",
    body: "Settings changes the season, shortages, war, and the dollar reading of a gold piece. That reading does not convert the coins. Scarcity raises rare and magic prices. Turn on repricing if shops that are already open should update. Otherwise only later shops use the new prices.",
  },
  {
    title: "Books",
    body: "Import a PDF you already own. It stays on the dungeon master's phone. Players cannot open or read it. You can stock a shop from its prices, or copy names and items into the index.",
  },
  {
    title: "Saves",
    body: "The save folder in Settings keeps named copies on this phone. You can export one, or import a Lootsplit file. Load replaces this campaign. The same password can lock those files. From the published app, Google Drive can hold a backup, a save, and a bug report in a Lootsplit folder. This copy of the app is version " + APP_VERSION + ".",
  },
  {
    title: "Campaigns",
    body: "The dungeon master can keep more than one campaign. Each has its own shops, money, index, names, and books. A player link cannot create, rename, open, or delete one.",
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
            The instructions are optional. No skips them. Yes shows them now. How Lootsplit works opens them later either way.
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
            Lootsplit {APP_VERSION} keeps a campaign's money, shops, and table. Local Mode stays on this phone. Turn based Mode and Live Mode share one table.
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
