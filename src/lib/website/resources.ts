/**
 * Add every new third-party content/data resource here when integrating it.
 * `kind: "reference"` marks engineering and design references (documentation,
 * APIs, layout inspiration) with nothing bundled; everything else is a credit.
 */
export type Resource = {
  name: string;
  kind?: "credit" | "reference";
  description: string;
  license?: string;
  links: { label: string; url: string }[];
};

export const resources: Resource[] = [
  {
    name: "Android home-screen widget platform references",
    kind: "reference",
    description:
      "Original Lootsplitter RemoteViews layouts, encrypted local widget state and launcher controls follow Android’s platform documentation. The owner’s phone images informed the green terminal style; no screenshots, wallpaper, third-party interface code or sample metrics are bundled in the release.",
    license:
      "Documentation reference; Android documentation CC BY 4.0 and code samples Apache 2.0. Original implementation, no sample code copied.",
    links: [
      {
        label: "Widget updates",
        url: "https://developer.android.com/develop/ui/views/appwidgets/advanced",
      },
      {
        label: "Responsive layouts",
        url: "https://developer.android.com/develop/ui/views/appwidgets/layouts",
      },
      {
        label: "Launcher placement",
        url: "https://developer.android.com/develop/ui/views/appwidgets/discoverability",
      },
      {
        label: "Android Keystore",
        url: "https://developer.android.com/privacy-and-security/keystore",
      },
      {
        label: "Widget provider metadata refresh",
        url: "https://developer.android.com/reference/android/appwidget/AppWidgetManager#updateAppWidgetProviderInfo(android.content.ComponentName,java.lang.String)",
      },
      {
        label: "Android launcher widget filtering (AOSP, Apache 2.0)",
        url: "https://android.googlesource.com/platform/packages/apps/Launcher3/+/64cdbf5c770ec63f50d44bd7c0c2f03dcac11310/src_shortcuts_overrides/com/android/launcher3/model/WidgetsModel.java",
      },
    ],
  },
  {
    name: "Owner monitoring data and API references",
    kind: "reference",
    description:
      "The private Field monitor reads this repository’s GitHub workflow and pull-request metadata. Optional Cloudflare analytics uses aggregate Worker requests/errors. The original website widget uses Lootsplitter’s existing theme; the owner’s phone screenshots are design references for the separate Android home-screen widget and are not bundled in the app.",
    license: "API data and documentation references; respective provider terms apply",
    links: [
      {
        label: "GitHub workflow runs",
        url: "https://docs.github.com/en/rest/actions/workflow-runs",
      },
      { label: "GitHub pull requests", url: "https://docs.github.com/en/rest/pulls/pulls" },
      {
        label: "Cloudflare Workers analytics",
        url: "https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/",
      },
    ],
  },
  {
    name: "Project Zomboid Map interface reference",
    kind: "reference",
    description:
      "The owner selected this interactive map as the explicit layout and interaction reference for Lootsplitter Maps: edge-to-edge canvas, floating search/navigation, compact right controls, horizontal tools and overlay options. Lootsplitter uses original components and campaign artwork; no game map, branding or third-party interface code is bundled.",
    license: "Design reference only; original source rights retained",
    links: [{ label: "Project Zomboid Map", url: "https://projectzomboidmap.com/#10990x9612x14" }],
  },
  {
    name: "Universal VTT interchange references",
    kind: "reference",
    description:
      "Original Lootsplitter importer follows documented UVTT 0.2/0.3 embedded image, grid, wall, portal and light fields. Exporter-specific behavior is disclosed for DM review. Documentation reference only; no third-party code or map artwork is bundled.",
    license: "Documentation reference; source site rights retained",
    links: [
      {
        label: "Arkenforge developer format notes",
        url: "https://arkenforge.com/universal-vtt-files/",
      },
      {
        label: "Encounter+ file type documentation",
        url: "https://docs.encounter.plus/reference/file-types/",
      },
    ],
  },
  {
    name: "Player display references",
    kind: "reference",
    description:
      "Original Lootsplitter presentation UI informed by the owner’s digital map-case reference. No video footage, map art, or third-party interface code is bundled. Browser fullscreen and casting behavior follows the linked platform documentation.",
    links: [
      { label: "Digital map-case reference", url: "https://youtube.com/shorts/lw6zef9PVMk" },
      {
        label: "Fullscreen API",
        url: "https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API",
      },
      { label: "Chrome tab casting", url: "https://support.google.com/chromecast/answer/3228332" },
    ],
  },
  {
    name: "Multiple-window web platform references",
    kind: "reference",
    description:
      "Lootsplitter’s original window controls and synchronization use standard browser APIs. Mozilla’s MDN documentation informed window opening, per-tab session storage, Web Locks and privacy-safe invalidation messages. No third-party interface assets or example code are bundled.",
    links: [
      { label: "Window.open", url: "https://developer.mozilla.org/en-US/docs/Web/API/Window/open" },
      {
        label: "Session storage",
        url: "https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage",
      },
      {
        label: "Web Locks API",
        url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API",
      },
      {
        label: "Broadcast Channel API",
        url: "https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API",
      },
    ],
  },
  {
    name: "Ship vehicle bookkeeping references",
    kind: "reference",
    description:
      "Component-based ship statistics were informed by Wizards of the Coast’s 2018 Ships and the Sea Unearthed Arcana playtest and the 2014 Basic Rules object damage-threshold guidance. These are references, not bundled stat blocks or adopted official prices. Lootsplitter’s editable demonstration ships, upgrades and economic defaults are original; mental abilities are omitted as requested.",
    links: [
      {
        label: "Ships and the Sea (2018 playtest)",
        url: "https://media.wizards.com/2018/dnd/downloads/UA_ShipsSea.pdf",
      },
      {
        label: "2014 Basic Rules: objects",
        url: "https://www.dndbeyond.com/sources/dnd/basic-rules-2014/running-the-game#Objects",
      },
    ],
  },
  {
    name: "Reviewed resource-pack imports",
    kind: "reference",
    description:
      "Lootsplitter’s import schema and synthetic example are original. User-imported books retain their supplied attribution, copyright and source-page references in the private DM library. Book contents and artwork are not bundled with the application. Campaign-private immutable document storage follows Cloudflare’s D1 limits and atomic batch documentation; importing grants no redistribution license.",
    links: [
      { label: "D1 limits", url: "https://developers.cloudflare.com/d1/platform/limits/" },
      {
        label: "D1 atomic batches",
        url: "https://developers.cloudflare.com/d1/worker-api/d1-database/#batch",
      },
    ],
  },
  {
    name: "Campaign map text recognition",
    description:
      "Map labels use the existing locally bundled Tesseract.js 7 engine (Apache-2.0) and English trained data. Lootsplitter's reviewed anchors, markers, fantasy controls and deed/barter integration are original. Cloudflare's official D1 limits and transaction documentation informed campaign-private deduplicated image storage; no third-party maps or artwork are supplied.",
    links: [
      { label: "Tesseract.js source and license", url: "https://github.com/naptha/tesseract.js" },
      { label: "English trained data", url: "https://github.com/tesseract-ocr/tessdata" },
      { label: "D1 limits", url: "https://developers.cloudflare.com/d1/platform/limits/" },
      {
        label: "D1 atomic batches",
        url: "https://developers.cloudflare.com/d1/worker-api/d1-database/#batch",
      },
    ],
  },
  {
    name: "Property marketplace design references",
    kind: "reference",
    description:
      "First-party Zillow and Redfin product guidance informed location-first search, asking-price filters, image listings and side-by-side comparison. Lootsplitter's fantasy interface and deed template are original; no listings, logos, photographs or proprietary app assets are copied.",
    links: [
      {
        label: "Zillow saved searches and homes",
        url: "https://zillow.zendesk.com/hc/en-us/articles/213395508-Saved-Searches-and-Saved-Homes",
      },
      {
        label: "Zillow advanced search",
        url: "https://www.zillow.com/learn/zillow-advanced-search/",
      },
      {
        label: "Redfin home search",
        url: "https://support.redfin.com/hc/en-us/articles/360001432632-Searching-for-Homes",
      },
      {
        label: "Redfin favorites and lists",
        url: "https://support.redfin.com/hc/en-us/articles/12559140934939-Favorites-Favorite-Lists",
      },
    ],
  },
  {
    name: "Free scene music and ambience",
    description:
      "Menu music: Soft Strings and Flutes and Dark and Mysterious from Fantasy Music and Drum Loops Pack by North Fantasy Music (CC BY 4.0), and Town Theme RPG by cynicmusic (CC0; cynicmusic.com pixelsphere.org). Ambience: Fireplace Sound loop by PagDev, water_flowing from 30 CC0 SFX loops by rubberduck, Crickets Ambient Noise by Ted Kerr (Wolfgang_), and Loopable Dungeon Ambience by JaggedStone (all CC0). Full tracks are converted to local 44.1 kHz MP3, with stereo music, mono ambience and short edge fades. Optional device-only controls; no remote streaming.",
    links: [
      {
        label: "North Fantasy Music pack",
        url: "https://opengameart.org/content/fantasy-music-and-drum-loops-pack",
      },
      { label: "Town Theme RPG", url: "https://opengameart.org/content/town-theme-rpg" },
      { label: "30 CC0 SFX loops", url: "https://opengameart.org/content/30-cc0-sfx-loops" },
      {
        label: "Fireplace Sound loop",
        url: "https://opengameart.org/content/fireplace-sound-loop",
      },
      {
        label: "Crickets Ambient Noise",
        url: "https://opengameart.org/content/crickets-ambient-noise-loopable",
      },
      {
        label: "Loopable Dungeon Ambience",
        url: "https://opengameart.org/content/loopable-dungeon-ambience",
      },
      { label: "Credits and adaptations", url: "/audio/scenes/CREDITS.txt" },
      { label: "Source file provenance", url: "/audio/scenes/sources.json" },
      { label: "CC BY 4.0 license", url: "/audio/scenes/LICENSE-CC-BY-4.0.txt" },
      { label: "CC0 license", url: "/audio/scenes/LICENSE-CC0.txt" },
    ],
  },
  {
    name: "CC0 fantasy backgrounds — willYEE",
    description:
      "Eight day/night scene pairs from Fantasy Visual Novel Backgrounds — 48 Painted Scenes, Day & Night, dedicated to the public domain under CC0 1.0. Selected images are resized to responsive WebP and bundled locally for web and Android submenu scenery. The creator discloses AI generation with Krea 2 and Real-ESRGAN upscaling. Scenery is optional; campaign and shop uploads remain separate.",
    links: [
      {
        label: "Original background pack",
        url: "https://willyee.itch.io/fantasy-visual-novel-backgrounds",
      },
      { label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
      { label: "File credits", url: "/scenes/fantasy/CREDITS.txt" },
      { label: "Bundled license", url: "/scenes/fantasy/LICENSE.txt" },
      { label: "Original documentation", url: "/scenes/fantasy/SOURCE-README.md" },
      { label: "Image sources and adaptations", url: "/scenes/fantasy/sources.json" },
    ],
  },
  {
    name: "CC0 fantasy sound effects — rubberduck",
    description:
      "Coin, loot and page-turn feedback from 80 CC0 RPG SFX by rubberduck, dedicated to the public domain under CC0 1.0. Selected OGG recordings converted to mono 44.1 kHz WAV for local web and Android playback. Sound effects are optional and never contain campaign data.",
    links: [
      { label: "Original sound pack", url: "https://opengameart.org/content/80-cc0-rpg-sfx" },
      { label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
      { label: "File credits", url: "/audio/cc0/CREDITS.txt" },
    ],
  },
  {
    name: "In-memory player storage",
    description:
      "fake-indexeddb implements the IndexedDB API in JavaScript memory (Apache License 2.0). Lootsplitter uses it for player sessions so campaign contents are not written to persistent browser databases.",
    links: [{ label: "Source and license", url: "https://github.com/dumbmatter/fakeIndexedDB" }],
  },
  {
    name: "Tesseract.js local OCR",
    description:
      "Tesseract.js and Tesseract (Apache License 2.0), with the MIT-licensed English data package read scanned PDFs and statblock pictures on your device. Lootsplitter bundles the worker, recognition models and compatible WASM cores; private files are not sent to an OCR service.",
    links: [
      { label: "Tesseract.js source", url: "https://github.com/naptha/tesseract.js" },
      { label: "English language data", url: "https://github.com/naptha/tessdata" },
      { label: "Apache License 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    ],
  },
  {
    name: "Game-icons.net fantasy icons",
    description:
      "Icons made by Lorc, Delapouite, Carl Olsen, Caro Asercion, Cathelineau, DarkZaitzev, Faithtoken, Lucas, Sbed, SeregaCthtuf, Skoll, Willdabeast and Zeromancer. Licensed under CC BY 3.0 (Zeromancer: CC0). Lootsplitter removes the square backgrounds and applies category colors and framing. Icons are bundled locally; existing custom artwork is preserved.",
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
      "Lootsplitter uses Open5e to retrieve SRD equipment, spells, SRD creatures for encounter generation, and other supported reference entries. Imported entries keep their individual source credits.",
    links: [
      { label: "Visit Open5e", url: "https://open5e.com" },
      { label: "Open5e licensing", url: "https://open5e.com/legal" },
    ],
  },
  ...["5.1", "5.2"].map((version) => ({
    name: `System Reference Document ${version}`,
    description: `This work includes material from the System Reference Document ${version} (“SRD ${version}”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD ${version} is licensed under the Creative Commons Attribution 4.0 International License. Retrieved through Open5e; formatting adapted. Prices and categories may be customized in Lootsplitter.${version === "5.2" ? " Service price presets (spellcasting services and their material components, including Identify, lodging and meals, spell scroll scribing, potion brewing, the crafting rule used for tailoring, and hireling wages, also used as the price of a training day, and the messenger rate per mile for courier letters) are taken from SRD 5.2.1, the current release of SRD 5.2, and may be customized. A fence's 30% buy rate and a bank's starting loan terms are house defaults, not SRD rules." : " SRD 5.1 service price presets (spellcasting services, including Identify, lodging and food per day, the crafting pace for brews and clothes, clothing prices and weights, and hireling wages, also used as the price of a training day, and the messenger rate per mile for courier letters) are taken from SRD 5.1 and may be customized."}`,
    links: [
      { label: "Original SRD", url: "https://www.dndbeyond.com/srd" },
      { label: "CC BY 4.0 license", url: "https://creativecommons.org/licenses/by/4.0/legalcode" },
    ],
  })),
  {
    name: "Typography",
    description:
      "Cormorant Garamond (upright and italic), Cormorant SC, Source Sans 3, and Source Serif 4 are distributed with Lootsplitter under the SIL Open Font License 1.1. Font files are the Fontsource latin subsets (Cormorant fonts by Christian Thalmann, The Cormorant Project Authors).",
    links: [
      { label: "Cormorant Garamond license", url: "/fonts/cormorant-garamond-LICENSE.txt" },
      { label: "Cormorant SC license", url: "/fonts/cormorant-sc-LICENSE.txt" },
      { label: "Cormorant project", url: "https://github.com/CatharsisFonts/Cormorant" },
      { label: "Source Sans 3 license", url: "/fonts/source-sans-3-LICENSE.txt" },
      { label: "Source Serif 4 license", url: "/fonts/source-serif-4-LICENSE.txt" },
    ],
  },
];
