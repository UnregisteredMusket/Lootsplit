import {
  encounterSchema,
  generatorSchema,
  generateEncounter,
  blankEncounter,
} from "../src/lib/encounters/model.mjs";
import { parseDice, throwDice } from "../src/lib/characters/model.mjs";
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const text = (v, max = 120) => {
  if (typeof v !== "string" || v.length > max) fail("Invalid encounter request.");
  return v;
};
const parse = (schema, v) => {
  const r = schema.safeParse(v);
  if (!r.success) fail(r.error.issues[0]?.message || "Check encounter fields.");
  return r.data;
};
export async function dmMembership(db, user, code) {
  if (code === "personal") return { personal: true, room: { table: { purses: [] } } };
  const m = await db
    .prepare("SELECT * FROM library_members WHERE user_id=? AND code=?")
    .bind(user, text(code, 16))
    .first();
  const row = await db.prepare("SELECT * FROM campaign_rooms WHERE code=?").bind(code).first();
  const room = row ? JSON.parse(row.body) : null;
  const seat = room?.seats.find((s) => s.id === m?.seat_id && s.token === m?.token);
  if (seat?.role !== "dm")
    fail(
      "Only an active saved campaign DM can use encounters. Save your DM membership in My account.",
      403,
    );
  return { room, raw: row.body, revision: row.revision, seat, m };
}
async function detail(db, user, id) {
  const row = await db
    .prepare("SELECT * FROM dm_encounters WHERE id=? AND user_id=?")
    .bind(text(id), user)
    .first();
  if (!row) fail("Encounter not found.", 404);
  return { row, ...(await dmMembership(db, user, row.code)) };
}
const view = (r) => ({ ...r, user_id: undefined, body: JSON.parse(r.body) });
async function save(db, user, d, encounter, status = d.row.status) {
  if (d.personal) {
    const result = await db
      .prepare(
        "UPDATE dm_encounters SET body=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND code='personal'",
      )
      .bind(JSON.stringify(encounter), status, Date.now(), d.row.id, user, d.row.revision)
      .run();
    if (!result.meta.changes) fail("Encounter changed. Export your draft and reload.", 409);
    return { id: d.row.id };
  }
  const result = await db
    .prepare(
      `UPDATE dm_encounters SET body=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?) AND EXISTS(SELECT 1 FROM library_members WHERE user_id=? AND code=? AND seat_id=? AND token=?)`,
    )
    .bind(
      JSON.stringify(encounter),
      status,
      Date.now(),
      d.row.id,
      user,
      d.row.revision,
      d.row.code,
      d.raw,
      user,
      d.row.code,
      d.m.seat_id,
      d.m.token,
    )
    .run();
  if (!result.meta.changes)
    fail("Encounter or campaign changed. Export your draft, then reload before retrying.", 409);
  return { id: d.row.id };
}
export { creatureIndex } from "../src/lib/encounters/index.mjs";
import { creatureIndex } from "../src/lib/encounters/index.mjs";
export async function handleEncounters(db, user, path, body = {}) {
  if (path === "encounters") {
    const ms = await db
      .prepare("SELECT code,name FROM library_members WHERE user_id=? AND archived=0")
      .bind(user)
      .all();
    const campaigns = [{ code: "personal", name: "My account drafts", purses: [] }];
    for (const m of ms.results) {
      try {
        const d = await dmMembership(db, user, m.code);
        campaigns.push({
          ...m,
          purses: d.room.table.purses.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
        });
      } catch (e) {
        if (e.status !== 403) throw e;
      }
    }
    const rows = await db
      .prepare(
        "SELECT id,code,body,status,revision,updated_at FROM dm_encounters WHERE user_id=? ORDER BY updated_at DESC",
      )
      .bind(user)
      .all();
    return {
      campaigns,
      encounters: rows.results
        .filter((r) => campaigns.some((c) => c.code === r.code))
        .map((r) => ({
          id: r.id,
          code: r.code,
          name: JSON.parse(r.body).name,
          status: r.status,
          updated_at: r.updated_at,
        })),
    };
  }
  if (path === "encounters/create") {
    const code = text(body.code, 16),
      d = await dmMembership(db, user, code),
      id = text(body.id);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) fail("Invalid encounter creation key.");
    const encounter = parse(encounterSchema, body.encounter || blankEncounter());
    const prior = await db
      .prepare("SELECT id,user_id,code FROM dm_encounters WHERE id=?")
      .bind(id)
      .first();
    if (prior) {
      if (prior.user_id !== user || prior.code !== code)
        fail("Encounter key is already in use.", 409);
      return { id };
    }
    if (d.personal) {
      await db
        .prepare(
          "INSERT INTO dm_encounters(id,user_id,code,body,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(id, user, code, JSON.stringify(encounter), Date.now(), Date.now())
        .run();
      return { id };
    }
    const created = await db
      .prepare(
        `INSERT INTO dm_encounters(id,user_id,code,body,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?) AND EXISTS(SELECT 1 FROM library_members WHERE user_id=? AND code=? AND seat_id=? AND token=?)`,
      )
      .bind(
        id,
        user,
        code,
        JSON.stringify(encounter),
        Date.now(),
        Date.now(),
        code,
        d.raw,
        user,
        code,
        d.m.seat_id,
        d.m.token,
      )
      .run();
    if (!created.meta.changes) fail("Campaign permissions changed. Refresh and retry.", 409);
    return { id };
  }
  if (path === "encounters/index" || path === "encounters/generate") {
    await dmMembership(db, user, text(body.code, 16));
    const g = parse(generatorSchema, body.filters);
    const rows = (await creatureIndex()).filter(
      (c) =>
        (!g.enemy || `${c.name} ${c.type}`.toLowerCase().includes(g.enemy.toLowerCase())) &&
        (!g.environment || c.environments.toLowerCase().includes(g.environment.toLowerCase())),
    );
    if (path.endsWith("/generate")) return { combatants: generateEncounter(rows, g) };
    const page = body.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > 100) fail("Invalid index page.");
    return {
      creatures: rows.slice((page - 1) * 20, page * 20),
      more: rows.length > page * 20,
      count: rows.length,
    };
  }
  if (!path.startsWith("encounters/")) return null;
  const d = await detail(db, user, body.id),
    e = JSON.parse(d.row.body);
  if (path === "encounters/detail") {
    const award = await db
      .prepare("SELECT body FROM dm_encounter_awards WHERE encounter_id=?")
      .bind(d.row.id)
      .first();
    return {
      ...view(d.row),
      purses: d.room.table.purses.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
      award: award ? JSON.parse(award.body) : null,
    };
  }
  if (path === "encounters/log") {
    const before = body.before ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before) || before < 1) fail("Invalid history page.");
    const rows = await db
      .prepare(
        "SELECT seq,body,created_at FROM dm_encounter_rolls WHERE encounter_id=? AND seq<? ORDER BY seq DESC LIMIT 51",
      )
      .bind(d.row.id, before)
      .all();
    return {
      rolls: rows.results
        .slice(0, 50)
        .map((r) => ({ ...JSON.parse(r.body), seq: r.seq, at: r.created_at })),
      more: rows.results.length > 50,
    };
  }
  if (path === "encounters/award") {
    if (d.personal)
      fail("Import this draft into a device or DM campaign before transferring loot.");
    const old = await db
      .prepare("SELECT body FROM dm_encounter_awards WHERE encounter_id=?")
      .bind(d.row.id)
      .first();
    if (old) return { award: JSON.parse(old.body), duplicate: true };
  }
  if (d.row.revision !== body.revision)
    fail("Encounter changed on another device. Export your draft and reload.", 409);
  if (d.row.status === "awarded")
    fail("This encounter has already been awarded and is read-only.", 409);
  if (path === "encounters/save") {
    const next = parse(encounterSchema, body.encounter);
    if (d.row.status === "review" && JSON.stringify(next.tables) !== JSON.stringify(e.tables))
      fail("Loot tables are resolved. Edit the loot award directly.");
    return save(db, user, d, next);
  }
  if (path === "encounters/start") {
    if (d.row.status !== "draft") fail("Only a draft encounter can be started.", 409);
    return save(db, user, d, e, "active");
  }
  if (path === "encounters/conclude") {
    if (d.row.status === "review") return { id: d.row.id };
    // Each table uses the explicitly selected manual result; no physical dice result is invented.
    for (const t of e.tables) {
      if (t.selected === null) fail(`Choose or roll a result for ${t.name} before concluding.`);
      e.loot.push({
        ...t.entries[t.selected].loot,
        id: crypto.randomUUID(),
        sourceTableId: t.id,
        notes: `${t.entries[t.selected].loot.notes}\nLoot table: ${t.name}`.trim(),
      });
    }
    return save(db, user, d, parse(encounterSchema, e), "review");
  }
  if (path === "encounters/roll") {
    const key = text(body.requestKey, 80);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) fail("Invalid roll key.");
    const prior = await db
      .prepare("SELECT body FROM dm_encounter_rolls WHERE encounter_id=? AND request_key=?")
      .bind(d.row.id, key)
      .first();
    if (prior) return JSON.parse(prior.body);
    if (d.row.status === "review") fail("The encounter is concluded.", 409);
    const manual = body.manual === true;
    let result;
    if (body.tableId) {
      const table = e.tables.find((t) => t.id === body.tableId);
      if (!table) fail("Loot table not found.");
      const totalWeight = table.entries.reduce((s, r) => s + r.weight, 0);
      const ceiling = Math.floor(4294967296 / totalWeight) * totalWeight;
      const bytes = new Uint32Array(1);
      do {
        crypto.getRandomValues(bytes);
      } while (bytes[0] >= ceiling);
      const die = (bytes[0] % totalWeight) + 1,
        dice = { dice: [die], total: die, modifier: 0 };
      let n = dice.total,
        selected = table.entries.length - 1;
      for (let i = 0; i < table.entries.length; i++) {
        n -= table.entries[i].weight;
        if (n <= 0) {
          selected = i;
          break;
        }
      }
      // Return a persisted draw. The DM applies and saves its index like a physical result.
      result = {
        label: table.name,
        formula: `1d${totalWeight}`,
        source: "server",
        ...dice,
        selected,
        tableId: table.id,
        resultName: table.entries[selected].loot.name,
      };
    } else {
      const formula = text(body.formula, 120);
      try {
        parseDice(formula);
      } catch (err) {
        fail(err.message);
      }
      if (manual && (!Number.isSafeInteger(body.total) || Math.abs(body.total) > 100000))
        fail("Enter a whole-number manual total.");
      result = {
        label: text(body.label || "Encounter roll"),
        formula,
        source: manual ? "manual" : "server",
        ...(manual ? { dice: [], total: body.total } : throwDice(formula)),
      };
    }
    if (d.personal) {
      await db
        .prepare(
          "INSERT INTO dm_encounter_rolls(encounter_id,request_key,body,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM dm_encounters WHERE id=? AND user_id=? AND revision=?) ON CONFLICT(encounter_id,request_key) DO NOTHING",
        )
        .bind(d.row.id, key, JSON.stringify(result), Date.now(), d.row.id, user, d.row.revision)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO dm_encounter_rolls(encounter_id,request_key,body,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM dm_encounters WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?) AND EXISTS(SELECT 1 FROM library_members WHERE user_id=? AND code=? AND seat_id=? AND token=?) ON CONFLICT(encounter_id,request_key) DO NOTHING`,
        )
        .bind(
          d.row.id,
          key,
          JSON.stringify(result),
          Date.now(),
          d.row.id,
          d.row.revision,
          d.row.code,
          d.raw,
          user,
          d.row.code,
          d.m.seat_id,
          d.m.token,
        )
        .run();
    }
    const receipt = await db
      .prepare("SELECT body FROM dm_encounter_rolls WHERE encounter_id=? AND request_key=?")
      .bind(d.row.id, key)
      .first();
    if (!receipt) fail("Encounter permissions changed. Refresh and retry.", 409);
    return JSON.parse(receipt.body);
  }
  if (path === "encounters/award") {
    if (d.row.status !== "review")
      fail("Conclude and review this encounter before transferring loot.", 409);
    if (Object.values(d.room.drafts || {}).some((rows) => rows.length))
      fail("Submit or discard pending campaign turns before awarding loot.", 409);
    if (!d.room.live && d.room.seats[d.room.turn]?.id !== d.seat.id)
      fail("Return the campaign turn to the DM before awarding loot.", 409);
    const room = structuredClone(d.room),
      at = Date.now(),
      receiptId = crypto.randomUUID();
    const findPurse = (id) => {
      const p = room.table.purses.find((p) => p.id === id);
      if (!p) fail("Choose an existing recipient for every item and coin award.");
      return p;
    };
    const coins = e.coins,
      copper = coins.cp + coins.sp * 10 + coins.ep * 50 + coins.gp * 100 + coins.pp * 1000;
    if (copper > 0) {
      const p = findPurse(e.coinPurseId);
      for (const k of Object.keys(coins)) {
        const v = p.coins[k] + coins[k];
        if (!Number.isSafeInteger(v)) fail("Award exceeds the supported coin balance.");
        p.coins[k] = v;
      }
      const total =
        p.coins.cp + p.coins.sp * 10 + p.coins.ep * 50 + p.coins.gp * 100 + p.coins.pp * 1000;
      if (!Number.isSafeInteger(total)) fail("Award exceeds the supported total coin balance.");
      room.table.ledger.push({
        id: crypto.randomUUID(),
        at,
        purseId: p.id,
        shopId: null,
        summary: `Encounter loot: ${e.name}`,
        copper,
        transactionType: "adjustment",
      });
    }
    for (const item of e.loot) {
      const p = findPurse(item.purseId);
      room.table.holdings.push({
        id: crypto.randomUUID(),
        purseId: p.id,
        name: item.name,
        kind: "item",
        quantity: item.quantity,
        unitCopper: item.unitCopper,
        notes: item.notes,
      });
      room.table.ledger.push({
        id: crypto.randomUUID(),
        at,
        purseId: p.id,
        shopId: null,
        summary: `Encounter loot: ${item.quantity} × ${item.name} (${e.name})`,
        copper: 0,
        transactionType: "adjustment",
      });
    }
    room.revision = d.revision + 1;
    const award = {
      receiptId,
      encounterId: d.row.id,
      name: e.name,
      code: d.row.code,
      at,
      coins,
      coinPurseId: e.coinPurseId,
      items: e.loot,
      recipients: room.table.purses
        .filter((p) => p.id === e.coinPurseId || e.loot.some((i) => i.purseId === p.id))
        .map((p) => ({ id: p.id, name: p.name })),
    };
    // D1 batch is one serializable transaction. A unique receipt is acquired only against
    // the current room, encounter and DM membership; every mutation requires that receipt.
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO dm_encounter_awards(encounter_id,receipt_id,body,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM dm_encounters WHERE id=? AND revision=? AND status='review') AND EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=? AND body=?) AND EXISTS(SELECT 1 FROM library_members WHERE user_id=? AND code=? AND seat_id=? AND token=?) ON CONFLICT(encounter_id) DO NOTHING`,
        )
        .bind(
          d.row.id,
          receiptId,
          JSON.stringify(award),
          at,
          d.row.id,
          d.row.revision,
          d.row.code,
          d.revision,
          d.raw,
          user,
          d.row.code,
          d.m.seat_id,
          d.m.token,
        ),
      db
        .prepare(
          "UPDATE campaign_rooms SET body=?,revision=? WHERE code=? AND EXISTS(SELECT 1 FROM dm_encounter_awards WHERE encounter_id=? AND receipt_id=?)",
        )
        .bind(JSON.stringify(room), room.revision, d.row.code, d.row.id, receiptId),
      db
        .prepare(
          "UPDATE dm_encounters SET status='awarded',revision=revision+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM dm_encounter_awards WHERE encounter_id=? AND receipt_id=?)",
        )
        .bind(at, d.row.id, d.row.id, receiptId),
    ]);
    const receipt = await db
      .prepare("SELECT body FROM dm_encounter_awards WHERE encounter_id=?")
      .bind(d.row.id)
      .first();
    if (!receipt)
      fail("The encounter or campaign changed. Reload and review before retrying.", 409);
    return { award: JSON.parse(receipt.body), duplicate: !results[0].meta.changes };
  }
  return null;
}
