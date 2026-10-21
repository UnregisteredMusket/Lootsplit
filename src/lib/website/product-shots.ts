/**
 * Real product screenshots captured from the synthetic "Wayfarers" campaign by
 * scripts/capture-product-screenshots.mjs (workflow: product-screenshots.yml).
 * Files live in public/product/<name>.webp. Alt text describes what each shows.
 */
export const productShots = {
  ledger: {
    alt: "The DM Desk for The Wayfarers, listing recent activity: encounter loot, a shop sale and Trade Exchange purchases with their coin movements",
  },
  loot: {
    alt: "Transfer reviewed loot: a recipient preview of each character’s items and the party purse’s coins before a one-time transfer",
  },
  party: {
    alt: "Party funds and inventory: combined wealth in coin, items and property above a searchable inventory of the party’s goods",
  },
  character: {
    alt: "A character sheet in Play view with HP, AC and speed, longbow and shortsword attacks, a dice tray and the character roll log",
  },
  market: {
    alt: "The Brass Lantern shop counter: paying from the party purse, stock totals and shop items with Buy buttons",
  },
  trade: {
    alt: "A Trade Exchange with commodity quotes, stock and wanted levels, and a seasonal price-history chart for building timber",
  },
  barter: {
    alt: "Trading and barter between two characters: each side’s inventory, the goods and coins offered and requested, and their recorded values",
  },
  maps: {
    alt: "A battle map of a smugglers’ cove with labeled rooms, combatant tokens, markers and the map toolbar",
  },
  encounter: {
    alt: "The initiative tracker in round 3: combatants in initiative order with HP, AC and a condition, plus damage and heal controls",
  },
  downtime: {
    alt: "A downtime preview awaiting DM approval: seven in-game days of revenue, loan installments, interest, expenses and hourly activities",
  },
  properties: {
    alt: "Property operations for a wharf warehouse: storage, construction and staff, with an active manager’s contract",
  },
  ships: {
    alt: "The ship The Gilded Heron: docked location and cargo, a rename form and its stat block with hull, helm and sails",
  },
  journal: {
    alt: "The session journal open to a party entry, The Drowned Archive, with an attached session report",
  },
  room: {
    alt: "A shared room’s party chat between players and the DM, beside connection, device backup and manual sharing panels",
  },
  "phone-home": {
    alt: "Player Home on a phone: the player’s character summary, links to the sheet, campaign and downtime, and services such as Bank and Party chat",
  },
} as const;

export type ProductShot = keyof typeof productShots;

export function productShotSize(name: ProductShot) {
  return name === "phone-home" ? { width: 780, height: 1688 } : { width: 1280, height: 800 };
}
