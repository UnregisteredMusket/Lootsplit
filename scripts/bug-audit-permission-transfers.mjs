import "fake-indexeddb/auto";
import { writeFile } from "node:fs/promises";
import { localAccountDb } from "./account-dev-db.mjs";
import { blankSheet } from "../src/lib/characters/model.mjs";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import {
  blankPurse,
  applyCloudTable,
  saveHolding,
  giveToPlayer,
  economySnapshot,
} from "../src/lib/quire/economy.ts";
import { sheetFromFields } from "../src/lib/quire/sheet.ts";
import { openRoom, choosePace, submitCommands, roomState } from "../src/lib/quire/cloud.server.ts";
const results = [],
  db = localAccountDb();
globalThis.__env__ = { DB: db };
try {
  const p = {
    ...blankPurse("character"),
    id: "owner-character",
    name: "Player-owned",
    sheetReadOnlyForDm: true,
    sheet: {
      ...blankSheet(),
      name: "Player-owned",
      hp: 8,
      maxHp: 20,
      level: 9,
      proficiency: 4,
      tempHp: 7,
    },
  };
  const dm = await openRoom({ name: "DM", table: { ...emptyCloudTable(), purses: [p] } });
  await choosePace({ ...dm, live: true });
  let canonicalBlocked = false;
  try {
    await submitCommands({
      ...dm,
      batchId: crypto.randomUUID(),
      commands: [
        {
          kind: "character",
          id: crypto.randomUUID(),
          purseId: p.id,
          before: p.sheet,
          sheet: { ...p.sheet, hp: 4 },
        },
      ],
    });
  } catch (e) {
    canonicalBlocked = /profile owner/.test(e.message);
  }
  const legacy = {
    ...sheetFromFields({ CharacterName: "Player-owned", STR: "10", AC: "10" }),
    purseId: p.id,
    importedAt: 1,
    hitPoints: "1 / 20",
  };
  let legacySaveAccepted = true;
  try {
    await submitCommands({
      ...dm,
      batchId: crypto.randomUUID(),
      commands: [{ kind: "sheet", id: crypto.randomUUID(), sheet: legacy }],
    });
  } catch {
    legacySaveAccepted = false;
  }
  const after = (await roomState(dm)).table.purses[0];
  results.push({
    name: "DM read-only boundary on alternate legacy save",
    failed: !canonicalBlocked || legacySaveAccepted,
    canonicalSaveBlocked: canonicalBlocked,
    legacySaveAccepted,
    actualHp: after.sheet.hp,
    ownerReadOnlyFlag: after.sheetReadOnlyForDm,
  });
  const a = { ...blankPurse("character"), id: "giver", name: "Giver" },
    b = { ...blankPurse("character"), id: "recipient", name: "Recipient" };
  await applyCloudTable({ ...emptyCloudTable(), purses: [a, b] });
  await saveHolding({
    id: "custom-sword",
    purseId: "giver",
    name: "Family blade",
    kind: "item",
    quantity: 1,
    unitCopper: 400,
    weight: 3,
    notes: "Family crest; magical light once per day",
    image: "/art/rogue.webp",
    category: "Weapons",
  });
  await giveToPlayer({
    fromId: "giver",
    toId: "recipient",
    copper: 0,
    holdingId: "custom-sword",
    quantity: 1,
  });
  const received = (await economySnapshot()).holdings.find((h) => h.purseId === "recipient");
  results.push({
    name: "Local transfer item metadata",
    failed:
      received.weight !== 3 ||
      received.notes !== "Family crest; magical light once per day" ||
      received.image !== "/art/rogue.webp" ||
      received.category !== "Weapons",
    expected: {
      weight: 3,
      notes: "Family crest; magical light once per day",
      image: "/art/rogue.webp",
      category: "Weapons",
    },
    actual: received,
  });
  await writeFile(
    "test-results/permission-transfer-results.json",
    JSON.stringify(results, null, 2),
  );
  for (const r of results) console.log(JSON.stringify(r));
} finally {
  db.close();
  process.exitCode = results.some((r) => r.failed) ? 1 : 0;
}
