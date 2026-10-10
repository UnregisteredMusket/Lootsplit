/** Add every new third-party content/data resource here when integrating it. */
export const resources = [
  { name: "Reviewed resource-pack imports", description: "Lootsplit’s import schema and synthetic example are original. User-imported books retain their supplied attribution, copyright and source-page references in the private DM library. Book contents and artwork are not bundled with the application. Campaign-private immutable document storage follows Cloudflare’s D1 limits and atomic batch documentation; importing grants no redistribution license.", links: [{label:"D1 limits",url:"https://developers.cloudflare.com/d1/platform/limits/"},{label:"D1 atomic batches",url:"https://developers.cloudflare.com/d1/worker-api/d1-database/#batch"}] },
  { name: "Campaign map text recognition", description: "Map labels use the existing locally bundled Tesseract.js 7 engine (Apache-2.0) and English trained data. Lootsplit's reviewed anchors, markers, fantasy controls and deed/barter integration are original. Cloudflare's official D1 limits and transaction documentation informed campaign-private deduplicated image storage; no third-party maps or artwork are supplied.", links: [{label:"Tesseract.js source and license",url:"https://github.com/naptha/tesseract.js"},{label:"English trained data",url:"https://github.com/tesseract-ocr/tessdata"},{label:"D1 limits",url:"https://developers.cloudflare.com/d1/platform/limits/"},{label:"D1 atomic batches",url:"https://developers.cloudflare.com/d1/worker-api/d1-database/#batch"}] },
  {
    name: "Property marketplace design references",
    description: "First-party Zillow and Redfin product guidance informed location-first search, asking-price filters, image listings and side-by-side comparison. Lootsplit's fantasy interface and deed template are original; no listings, logos, photographs or proprietary app assets are copied.",
    links: [
      { label: "Zillow saved searches and homes", url: "https://zillow.zendesk.com/hc/en-us/articles/213395508-Saved-Searches-and-Saved-Homes" },
      { label: "Zillow advanced search", url: "https://www.zillow.com/learn/zillow-advanced-search/" },
      { label: "Redfin home search", url: "https://support.redfin.com/hc/en-us/articles/360001432632-Searching-for-Homes" },
      { label: "Redfin favorites and lists", url: "https://support.redfin.com/hc/en-us/articles/12559140934939-Favorites-Favorite-Lists" },
    ],
  },
  {
    name: "Free scene music and ambience",
    description: "Menu music: Soft Strings and Flutes and Dark and Mysterious from Fantasy Music and Drum Loops Pack by North Fantasy Music (CC BY 4.0), and Town Theme RPG by cynicmusic (CC0; cynicmusic.com pixelsphere.org). Ambience: Fireplace Sound loop by PagDev, water_flowing from 30 CC0 SFX loops by rubberduck, Crickets Ambient Noise by Ted Kerr (Wolfgang_), and Loopable Dungeon Ambience by JaggedStone (all CC0). Full tracks are converted to local 44.1 kHz MP3, with stereo music, mono ambience and short edge fades. Optional device-only controls; no remote streaming.",
    links: [
      { label: "North Fantasy Music pack", url: "https://opengameart.org/content/fantasy-music-and-drum-loops-pack" },
      { label: "Town Theme RPG", url: "https://opengameart.org/content/town-theme-rpg" },
      { label: "30 CC0 SFX loops", url: "https://opengameart.org/content/30-cc0-sfx-loops" },
      { label: "Fireplace Sound loop", url: "https://opengameart.org/content/fireplace-sound-loop" },
      { label: "Crickets Ambient Noise", url: "https://opengameart.org/content/crickets-ambient-noise-loopable" },
      { label: "Loopable Dungeon Ambience", url: "https://opengameart.org/content/loopable-dungeon-ambience" },
      { label: "Credits and adaptations", url: "/audio/scenes/CREDITS.txt" },
      { label: "Source file provenance", url: "/audio/scenes/sources.json" },
      { label: "CC BY 4.0 license", url: "/audio/scenes/LICENSE-CC-BY-4.0.txt" },
      { label: "CC0 license", url: "/audio/scenes/LICENSE-CC0.txt" },
    ],
  },
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
