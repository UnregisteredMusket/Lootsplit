/** Add every new third-party content/data resource here when integrating it. */
export const resources = [
  {
    name: "CC0 fantasy backgrounds — willYEE",
    description: "Eight day/night scene pairs from Fantasy Visual Novel Backgrounds — 48 Painted Scenes, Day & Night, dedicated to the public domain under CC0 1.0. Selected images are resized to responsive WebP and bundled locally for web and Android submenu scenery. The creator discloses AI generation with Krea 2 and Real-ESRGAN upscaling. Scenery is optional; campaign and shop uploads remain separate.",
    links: [
      { label: "Original background pack", url: "https://willyee.itch.io/fantasy-visual-novel-backgrounds" },
      { label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
      { label: "File credits", url: "/scenes/fantasy/CREDITS.txt" },
      { label: "Bundled license", url: "/scenes/fantasy/LICENSE.txt" },
      { label: "Original documentation", url: "/scenes/fantasy/SOURCE-README.md" },
      { label: "Image sources and adaptations", url: "/scenes/fantasy/sources.json" },
    ],
  },
  {
    name: "CC0 fantasy sound effects — rubberduck",
    description: "Coin, loot and page-turn feedback from 80 CC0 RPG SFX by rubberduck, dedicated to the public domain under CC0 1.0. Selected OGG recordings converted to mono 44.1 kHz WAV for local web and Android playback. Sound effects are optional and never contain campaign data.",
    links: [
      { label: "Original sound pack", url: "https://opengameart.org/content/80-cc0-rpg-sfx" },
      { label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
      { label: "File credits", url: "/audio/cc0/CREDITS.txt" },
    ],
  },
  {
    name: "In-memory player storage",
    description: "fake-indexeddb implements the IndexedDB API in JavaScript memory (Apache License 2.0). Lootsplit uses it for player sessions so campaign contents are not written to persistent browser databases.",
    links: [{ label: "Source and license", url: "https://github.com/dumbmatter/fakeIndexedDB" }],
  },
  {
    name: "Tesseract.js local OCR",
    description:
      "Tesseract.js and Tesseract (Apache License 2.0), with the MIT-licensed English data package read scanned PDFs and statblock pictures on your device. Lootsplit bundles the worker, recognition models and compatible WASM cores; private files are not sent to an OCR service.",
    links: [
      { label: "Tesseract.js source", url: "https://github.com/naptha/tesseract.js" },
      { label: "English language data", url: "https://github.com/naptha/tessdata" },
      { label: "Apache License 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    ],
  },
  {
    name: "Game-icons.net fantasy icons",
    description:
      "Icons made by Lorc, Delapouite, Carl Olsen, Caro Asercion, Cathelineau, DarkZaitzev, Faithtoken, Lucas, Sbed, SeregaCthtuf, Skoll, Willdabeast and Zeromancer. Licensed under CC BY 3.0 (Zeromancer: CC0). Lootsplit removes the square backgrounds and applies category colors and framing. Icons are bundled locally; existing custom artwork is preserved.",
    links: [
      { label: "Game-icons.net", url: "https://game-icons.net/" },
      { label: "CC BY 3.0 license", url: "https://creativecommons.org/licenses/by/3.0/" },
      { label: "CC0 license", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
      { label: "Artist credits and adaptations", url: "/icons/game-icons/ATTRIBUTION.txt" },
      { label: "Original license and author links", url: "/icons/game-icons/LICENSE.txt" },
      { label: "Individual icon sources", url: "/icons/game-icons/sources.json" },
    ],
  },
  {
    name: "Standby database connectivity",
    description:
      "The optional recovery server uses Turso's libSQL TypeScript client, distributed under the MIT License.",
    links: [
      {
        label: "libSQL client source and license",
        url: "https://github.com/tursodatabase/libsql-client-ts",
      },
    ],
  },
  {
    name: "D&D 2014 encounter difficulty",
    description:
      "Encounter estimates use the 2014 Basic Rules XP thresholds and party-size multipliers. The generator is an editable estimate; terrain, tactics and house rules require DM judgment.",
    links: [
      {
        label: "Building Combat Encounters (2014)",
        url: "https://www.dndbeyond.com/sources/dnd/basic-rules-2014/building-combat-encounters",
      },
    ],
  },
  {
    name: "Open5e",
    description:
      "Lootsplit uses Open5e to retrieve SRD equipment, spells, SRD creatures for encounter generation, and other supported reference entries. Imported entries keep their individual source credits.",
    links: [
      { label: "Visit Open5e", url: "https://open5e.com" },
      { label: "Open5e licensing", url: "https://open5e.com/legal" },
    ],
  },
  ...["5.1", "5.2"].map((version) => ({
    name: `System Reference Document ${version}`,
    description: `This work includes material from the System Reference Document ${version} (“SRD ${version}”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD ${version} is licensed under the Creative Commons Attribution 4.0 International License. Retrieved through Open5e; formatting adapted. Prices and categories may be customized in Lootsplit.`,
    links: [
      { label: "Original SRD", url: "https://www.dndbeyond.com/srd" },
      { label: "CC BY 4.0 license", url: "https://creativecommons.org/licenses/by/4.0/legalcode" },
    ],
  })),
  {
    name: "Typography",
    description:
      "Cormorant Garamond, Source Sans 3, and Source Serif 4 are distributed with Lootsplit under the SIL Open Font License 1.1.",
    links: [
      { label: "Cormorant Garamond license", url: "/fonts/cormorant-garamond-LICENSE.txt" },
      { label: "Source Sans 3 license", url: "/fonts/source-sans-3-LICENSE.txt" },
      { label: "Source Serif 4 license", url: "/fonts/source-serif-4-LICENSE.txt" },
    ],
  },
];
