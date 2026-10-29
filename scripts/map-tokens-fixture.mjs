// Disposable device campaign for the map tokens audits (docs/plans/MAP-TOKENS.md): "The Old Keep",
// a 28 × 18 battle grid of 44 px squares drawn like the approved mockups (grass, a road, a river
// and a stone keep), the party Mira, Torvald, Sela and Bram, and Kett in a second group. Nothing
// here touches a real campaign; it is applied with the device engine's applyCloudTable.
import { continueIntoApp } from "./title-screen-navigation.mjs";

export const KEEP = { columns: 28, rows: 18, cell: 44 };

/** Seed the campaign; `tokens` and `tabletop` override the defaults for one audit. */
export async function seedKeep(page, { tokens, tabletop, extraMaps = [], world = {} } = {}) {
  await page.evaluate(
    async ({ KEEP, tokens, tabletop, extraMaps, world }) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      const { readJournal } = await import("/src/lib/quire/journal.ts");
      const { fromCopper } = await import("/src/lib/quire/money.ts");
      const canvas = document.createElement("canvas");
      canvas.width = KEEP.columns * KEEP.cell;
      canvas.height = KEEP.rows * KEEP.cell;
      const c = canvas.getContext("2d");
      c.fillStyle = "#33492c";
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.strokeStyle = "#b39466";
      c.lineWidth = 40;
      c.beginPath();
      c.moveTo(0, 640);
      c.lineTo(430, 470);
      c.lineTo(900, 470);
      c.lineTo(1232, 300);
      c.stroke();
      c.strokeStyle = "#2f6f93";
      c.lineWidth = 26;
      c.beginPath();
      c.moveTo(1010, 0);
      c.bezierCurveTo(940, 260, 1040, 520, 980, 792);
      c.stroke();
      c.fillStyle = "#4a4a48";
      c.fillRect(430, 268, 468, 380);
      c.fillStyle = "#2a2a28";
      c.fillRect(430, 268, 468, 14);
      c.fillRect(422, 640, 476, 14);
      for (const [x, y, r] of [[120, 120, 50], [240, 260, 40], [1150, 160, 60], [180, 700, 55], [1100, 700, 50]]) {
        c.fillStyle = "#22361f";
        c.beginPath();
        c.arc(x, y, r, 0, 7);
        c.fill();
      }
      const image = canvas.toDataURL("image/png");
      const person = (id, name, copper = 1000) => ({ id, name, kind: "character", coins: fromCopper(copper) });
      const character = (id, label, column, row) => ({ id: `${id}-token`, kind: "character", entityId: id, label, column, row, visibility: "party" });
      await applyCloudTable({
        purses: [
          { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(5000) },
          person("mira", "Mira"),
          person("torvald", "Torvald"),
          person("sela", "Sela"),
          person("bram", "Bram"),
          person("kett", "Kett"),
        ],
        holdings: [],
        shops: [],
        stock: [],
        ledger: [],
        listings: [],
        loans: [],
        sheets: [],
        notes: [],
        journal: readJournal({
          market: {
            currentLocationId: "testville",
            locations: [
              { id: "greenvale", name: "Greenvale", kind: "region", parentId: null, description: "" },
              { id: "testville", name: "Testville", kind: "city", parentId: "greenvale", description: "" },
            ],
          },
          world: {
            maps: [
              {
                id: "keep",
                name: "The Old Keep",
                type: "battle",
                locationId: "testville",
                image,
                visible: true,
                anchors: [],
                markers: [],
                grid: { columns: KEEP.columns, rows: KEEP.rows, feetPerTile: 5, diagonal: "equal", x: 0, y: 0, width: 1, height: 1 },
                tokens: tokens ?? [
                  character("mira", "Mira", 12, 7),
                  character("torvald", "Torvald", 13, 7),
                  character("sela", "Sela", 12, 8),
                  character("bram", "Bram", 13, 8),
                ],
                ...(tabletop ? { tabletop } : {}),
              },
              ...extraMaps.map((m) => ({ ...m, image: m.image ?? image })),
            ],
            ...world,
          },
        }),
      });
    },
    { KEEP, tokens, tabletop, extraMaps, world },
  );
}

/** Seat the page as the DM, or as a player of these characters (device campaigns). */
export const seatAs = (page, purseIds) =>
  page.evaluate(async (ids) => {
    const { setSeat, DM_SEAT } = await import("/src/lib/quire/table.ts");
    setSeat(ids ? { ...DM_SEAT, role: "player", purseIds: ids, shopIds: [], openedAt: Date.now() } : DM_SEAT);
  }, purseIds);

export const journalOf = (page) =>
  page.evaluate(async () => {
    const { economySnapshot } = await import("/src/lib/quire/economy.ts");
    return (await economySnapshot()).journal;
  });

export async function openKeep(page, origin, map = "keep") {
  await page.goto(origin + "/maps?map=" + map);
  await continueIntoApp(page);
  await page.getByRole("region", { name: "Interactive campaign map", exact: true }).waitFor();
  await settle(page);
}
/** Wait until the map camera stops moving (opening view, fit or zoom). */
export async function settle(page) {
  let last = "";
  for (let i = 0; i < 40; i++) {
    const box = JSON.stringify(await page.locator(".map-view-frame .map-viewport .map-layer").boundingBox());
    if (box === last && box !== "null") return;
    last = box;
    await page.waitForTimeout(150);
  }
}

/** Screen point of a grid square's centre (fractional squares allowed). */
export async function squarePoint(page, column, row) {
  const layer = await page.locator(".map-view-frame .map-viewport .map-layer").boundingBox();
  return {
    x: layer.x + (column / KEEP.columns) * layer.width,
    y: layer.y + (row / KEEP.rows) * layer.height,
  };
}

export const noSidewaysScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
