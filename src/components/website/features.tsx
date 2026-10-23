import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { ProductShot } from "@/lib/website/product-shots";
import { DmTag, Kicker, PageHero, Shot } from "./parts";
import { Website } from "./site";

type Item = { lead: string; text: ReactNode; dm?: boolean };
type Area = {
  id: string;
  chip: string;
  numeral: string;
  kicker: string;
  title: string;
  lead: string;
  shot: ProductShot;
  insets?: ProductShot[];
  items: Item[];
};

/** Public feature tour. In-app screens stay at /features/$feature. */
const featureAreas: Area[] = [
  {
    id: "money",
    chip: "Loot & money",
    numeral: "I",
    kicker: "The ledger",
    title: "Loot & money",
    lead: "Every coin and item, in one shared record.",
    shot: "ledger",
    insets: ["loot"],
    items: [
      {
        lead: "Five coin denominations",
        text: "with conversion, payments, transfers and optional real-money estimates",
      },
      {
        lead: "Even coin splits",
        text: "from a party fund or a purse, shared to the copper with the leftover sent where you choose",
      },
      {
        lead: "Treasure pool claims",
        text: "the party marks Need, Greed or Pass; the DM resolves by hand, at random or round-robin, and items move once",
      },
      {
        lead: "Loot awards",
        text: "from guaranteed items and weighted loot tables, coins sent to one purse or split evenly, reviewed before one transfer",
        dm: true,
      },
      { lead: "Party purses", text: "and player and NPC accounts with shared inventory" },
      { lead: "Activity ledger", text: "with voiding and full history" },
      { lead: "Bank and loans", text: "with interest, installments and repayments" },
    ],
  },
  {
    id: "characters",
    chip: "Characters",
    numeral: "II",
    kicker: "The party",
    title: "Characters & party",
    lead: "Full sheets that share one wallet and inventory with the campaign.",
    shot: "character",
    insets: ["party"],
    items: [
      {
        lead: "Character sheets",
        text: "with abilities, attacks, spells and slots, resources and features, in Play and Edit views",
      },
      {
        lead: "Import",
        text: "from JSON, filled PDF forms, or scanned pages read on your device",
      },
      {
        lead: "Built-in dice",
        text: "with advantage, custom formulas and roll history, or record physical dice",
      },
      { lead: "Per-field permissions", text: "and edit reports", dm: true },
      {
        lead: "Player Home",
        text: "with sheet, bank, finances, properties, journal and party chat",
      },
    ],
  },
  {
    id: "markets",
    chip: "Shops & trade",
    numeral: "III",
    kicker: "The market",
    title: "Shops, trade & barter",
    lead: "Merchants, markets and deals, all posted to the ledger.",
    shot: "market",
    insets: ["trade", "barter"],
    items: [
      {
        lead: "Shops",
        text: "with keepers, stock generation, restocks, custom prices and buy/sell rates",
      },
      {
        lead: "Shop calendars",
        text: "on in-game days and Charisma-based pricing",
        dm: true,
      },
      {
        lead: "Trade Exchanges",
        text: ": regional commodity markets with quotes, seasons and price charts",
      },
      {
        lead: "Trading & Barter",
        text: "between players: coins, goods and deeds, with counteroffers",
      },
      {
        lead: "Black markets",
        text: (
          <>
            and <b>blacksmith commissions</b> with materials and enchantments
          </>
        ),
        dm: true,
      },
    ],
  },
  {
    id: "world",
    chip: "World",
    numeral: "IV",
    kicker: "The world",
    title: "NPCs, property & ships",
    lead: "Build the campaign world and connect it to the economy.",
    shot: "properties",
    insets: ["ships"],
    items: [
      {
        lead: "Locations",
        text: ": regions, towns and areas with images and assigned shops",
        dm: true,
      },
      {
        lead: "People & NPCs",
        text: "with their own inventories, dialogue, trade and private conversations",
      },
      {
        lead: "Property",
        text: ": listings, purchase with a deed, storage, building projects, staff, tenants and upkeep",
      },
      {
        lead: "Ships and shipyards",
        text: ": crew, cargo, passengers, berths and voyages during downtime",
      },
    ],
  },
  {
    id: "encounters",
    chip: "Encounters & maps",
    numeral: "V",
    kicker: "The battle",
    title: "Encounters & maps",
    lead: "Build, run and reward combat, on a map everyone can see.",
    shot: "encounter",
    insets: ["maps"],
    items: [
      {
        lead: "Encounter builder",
        text: "with the SRD creature index, or generate by party level and difficulty",
        dm: true,
      },
      { lead: "Initiative tracker", text: "with rounds, HP, AC and conditions", dm: true },
      {
        lead: "Maps",
        text: ": regional, city, dungeon and battle scenes linked together, with markers and five-color pings",
      },
      {
        lead: "Online tabletop",
        text: ": tokens, measurements, fog of war, walls, doors, lights and vision",
      },
      {
        lead: "TV / player display",
        text: "showing only the map, combatants and loot you choose",
      },
    ],
  },
  {
    id: "downtime",
    chip: "Downtime",
    numeral: "VI",
    kicker: "Between adventures",
    title: "Sessions & downtime",
    lead: "Time, money owed and what characters do between sessions.",
    shot: "downtime",
    items: [
      { lead: "Session Time", text: ": advance hours with rest and prorated labor", dm: true },
      {
        lead: "Downtime",
        text: "from a day to ten years, applied only after the DM previews and approves it",
      },
      { lead: "Training", text: "for characters and NPCs, logged by the hour" },
      {
        lead: "Recurring revenue and expenses",
        text: "settled with loans, property and voyages",
      },
      { lead: "Review Inbox", text: "for payments, loans, imports and training", dm: true },
    ],
  },
  {
    id: "together",
    chip: "Play together",
    numeral: "VII",
    kicker: "The table",
    title: "Play together",
    lead: "In one room, by turns, or live online.",
    shot: "room",
    items: [
      { lead: "Three play modes", text: ": Local, Turn-based and Live" },
      {
        lead: "Room codes and invitation links",
        text: "; assign characters to players",
      },
      { lead: "Guests welcome", text: ": players join without an account" },
      { lead: "Party and private chat", text: "with unread markers and notifications" },
      { lead: "Keep the room online", text: "between sessions, then resume", dm: true },
    ],
  },
  {
    id: "library",
    chip: "Library & table tools",
    numeral: "VIII",
    kicker: "The shelf",
    title: "Library & table tools",
    lead: "References, records and atmosphere.",
    shot: "journal",
    items: [
      { lead: "Journal", text: "with session reports and DM, party and private entries" },
      { lead: "SRD 2014 and 2024", text: "spells, items and creatures, with attribution" },
      {
        lead: "Private PDF books",
        text: "kept on your device, with search and price import",
        dm: true,
      },
      { lead: "Music and ambience", text: "with your own device tracks per scene", dm: true },
      {
        lead: "Two themes",
        text: ", Adventurer’s Ledger and Ironbound Dragon, plus multi-window and multi-monitor layouts",
      },
    ],
  },
];

function FeatureList({ items }: { items: Item[] }) {
  return (
    <ul className="ls-feature-list">
      {items.map((item) => (
        <li key={item.lead}>
          <b>{item.lead}</b>
          {typeof item.text === "string" && /^[,:;]/.test(item.text) ? "" : " "}
          {item.text}
          {item.dm && (
            <>
              {" "}
              <DmTag />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FeaturesPage() {
  return (
    <Website footer="ink">
      <PageHero kicker="The whole campaign" title="Features">
        <p className="ls-lead ls-measure">
          It started with splitting loot. Now the ledger sits at the center of everything your
          table tracks, from the first copper piece to a fleet of ships. Every feature is free.
        </p>
        <nav aria-label="Feature areas" className="ls-chips">
          {featureAreas.map((area) => (
            <a key={area.id} className="ls-chip" href={`#${area.id}`}>
              {area.chip}
            </a>
          ))}
          <a className="ls-chip" href="#platforms">
            Platforms
          </a>
        </nav>
        <p className="ls-fine">
          <DmTag /> marks tools for the Dungeon Master
        </p>
      </PageHero>

      {featureAreas.map((area, index) => {
        const tone = index % 2 === 0 ? "paper" : "ink";
        return (
          <section
            key={area.id}
            id={area.id}
            className={`ls-${tone} ls-section ls-anchor`}
            aria-labelledby={`${area.id}-title`}
          >
            <div className={`ls-wrap ls-feature-area${index % 2 ? " is-flip" : ""}`}>
              <Shot name={area.shot} tone={tone} />
              <div className="ls-stack">
                <div className="ls-area-head">
                  <Kicker>
                    {area.numeral} · {area.kicker}
                  </Kicker>
                  <h2 id={`${area.id}-title`} className="ls-display">
                    {area.title}
                  </h2>
                </div>
                <p className="ls-lead">{area.lead}</p>
                <FeatureList items={area.items} />
                {area.insets && (
                  <div className="ls-insets">
                    {area.insets.map((inset) => (
                      <Shot key={inset} name={inset} tone={tone} size="inset" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })}

      <section
        id="platforms"
        className="ls-paper ls-section ls-anchor"
        aria-labelledby="platforms-title"
      >
        <div className="ls-wrap ls-feature-area is-flip">
          <Shot name="phone-home" tone="paper" />
          <div className="ls-stack">
            <Kicker>IX · Anywhere</Kicker>
            <h2 id="platforms-title" className="ls-display">
              Platforms, accounts & backups
            </h2>
            <p className="ls-lead">The same campaign in the browser, on Android and at the table.</p>
            <FeatureList
              items={[
                { lead: "Browser app", text: "on desktop and phone, always current" },
                {
                  lead: "Android app",
                  text: ", permanently signed, with device campaigns that work offline",
                },
                {
                  lead: "Optional accounts",
                  text: ": your campaigns on any device, reusable character profiles",
                },
                {
                  lead: "Backups",
                  text: "on the device and private cloud versions, with protected saves",
                },
              ]}
            />
            <Link className="ls-btn ls-btn-ink ls-self-start" to="/downloads">
              Compare Browser and Android
            </Link>
          </div>
        </div>
      </section>
    </Website>
  );
}
