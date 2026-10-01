import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { APP_VERSION } from "@/lib/quire/version";

const OFFER = "quire.guide.offer.v3";

const sections: Array<{ title: string; body: string; points?: Array<{ label: string; body: string }> }> = [
  {
    "title": "Set up a campaign",
    "body": "Open Settings to create or select a campaign. Each campaign has separate characters, funds, inventory, shops, catalog entries, and imported PDFs. Campaign data is stored in this browser on this device. Export a backup before clearing browser data or moving to another device."
  },
  {
    "title": "Add characters and funds",
    "body": "On Party, add characters and a shared party fund. Mark characters as Player or NPC; only player characters can be assigned to players. Set coin balances, record payments, and add items or property. Use Give to transfer coins or holdings to another player."
  },
  {
    "title": "Use the dashboard and character sheet",
    "body": "Home shows balances, inventory value, and recent transactions. Players can open Sheet to view their assigned character and inventory. On mobile, Multiplayer contains rooms, codes, players, and messages. More contains Market, Catalog or Character sheet, Books, and Settings. Import a supported D&D 5e (2014) character sheet from a filled PDF or JSON file. Image-only scans are not supported."
  },
  {
    "title": "Create and manage shops",
    "body": "Catalog contains the items shops can stock and names used by the shop generator. Add items manually, generate items, or extract priced items from an imported PDF. In Market, create a shop and choose its category, wealth, stock level, and price settings. Shuffle generates a new name, shopkeeper, location, and stock."
  },
  {
    "title": "Buy, sell, and request loans",
    "body": "Open a shop, choose the account to use, and buy or sell items. Blank stock quantities mean unlimited supply. A character’s imported Charisma score reduces purchase prices by 1% per point above 10, up to 20%; the party fund does not receive this discount. Players can request loans, which add funds only after DM approval."
  },
  {
    "title": "Choose a sharing mode",
    "body": "Open Multiplayer to start or join a room. The host chooses Live or Turn-based. Players also need access to the published site; a campaign code does not grant site access.",
    "points": [
      {
        "label": "Local Mode",
        "body": "Each browser has a separate copy. In Multiplayer → Manual sharing & files, the DM selects shops and copies a character’s player link or downloads their player file. Party-fund access is optional. Players return an activity report link or file, which the DM reviews and imports. Conflicting funds, inventory, or stock changes are rejected. After an accepted report, send a fresh player copy before the next round of activity. Reports from older app versions need manual reconciliation. Copying a link does not send it; share it with the recipient yourself."
      },
      {
        "label": "Turn-based Mode",
        "body": "The DM opens a shared campaign and shares its code. Players enter the code in Share and select an available character. Only the current participant can make transactions. Actions are saved as a draft on this device and, while connected, on the server. Submit changes and end turn commits the draft and passes control. Messages are shared immediately."
      },
      {
        "label": "Live Mode",
        "body": "Participants can make changes without waiting for a turn. Updates sync through the shared campaign. Only the DM can change modes. Server checks prevent overspending and overselling. Failed actions stay pending for review or retry."
      }
    ]
  },
  {
    "title": "Exchange messages and player activity",
    "body": "Use Share to write to the DM, the party, or selected players. In Local Mode, saved messages travel with the next player link or activity report. In both shared modes, messages are sent independently of transaction turns. In Live Mode, transactions sync automatically. Activity reports include purchases, sales, transfers, loan requests, and messages. They also record a switch from player to DM."
  },
  {
    "title": "Manage roles and passwords",
    "body": "Use the role control at the top of the app to switch roles. Set a campaign password in Settings before switching to player. Returning to DM requires that password. Shared modes prevent role changes. Return to Local Mode or disconnect first. The DM manages campaign settings, shop prices, catalog entries, and imported books."
  },
  {
    "title": "Adjust the economy",
    "body": "Settings includes season, shortage, war, plague, roads, scarcity, and inflation controls. These affect generated prices. Enable automatic repricing to update existing shops when modifiers change, or use Reprice open shops now. The estimated dollar equivalent is a display comparison and does not change coin balances."
  },
  {
    "title": "Import books and share handouts",
    "body": "Import a PDF with selectable text in Books. The PDF remains in this browser and is not included in player links. Select an entry as a handout to share its text. Extracted items and prices should be reviewed before adding them to the catalog or a shop."
  },
  {
    "title": "Save and restore backups",
    "body": "In Settings, Device backups stores named snapshots in this browser. Save creates a snapshot; Export downloads it; Import adds a backup file to the list; Load replaces the current campaign with that snapshot. Home provides direct download and restore for unprotected campaigns. Protected backups use Device backups and require a password. Keep an exported copy outside the browser. Enable Protect saves to encrypt backup files with the campaign password. Download backup saves the current campaign to a device file. Shared-mode backups refresh from the server and require your pending actions to be resolved first. Players can back up only the data visible to them; the DM keeps the complete campaign copy. Pending-action recovery is available separately in the sync panel. Disconnect or return to Local Mode before loading a backup; loading does not reconnect or overwrite a shared room. You can download diagnostic reports and share them manually."
  },
  {
    "title": "Recover shared sessions",
    "body": "Sync status shows pending actions and connection errors. Review or export pending actions before discarding them. Recovery files can be imported into the same campaign code. Sessions are remembered in this browser. If a character is stuck on another device, the DM can release it after pending actions are resolved. The DM can also grant party-fund access or choose the next participant. Mode changes and room closure require all submitted drafts to be resolved; offline actions remain saved on their original device."
  },
  {
    "title": "Enable notifications",
    "body": "Enable Notifications in Share or Settings and allow browser permission. Notifications cover messages, mode changes, and turns while Lootsplit is running; they are not email alerts or guaranteed notifications after the app closes."
  }
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
        Help
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
            View the setup guide now, or open Help anytime.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => answer(false)}>Not now</Button>
            <Button onClick={() => answer(true)}>View guide</Button>
          </div>
        </div>
      </Modal>
      <Modal open={open} onOpenChange={setOpen} title="How Lootsplit works">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Lootsplit {APP_VERSION} helps you manage campaign funds, inventory, shops, and player updates.
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
