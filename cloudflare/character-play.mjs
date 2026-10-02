import { sheetSchema, rollSpec, parseDice, throwDice } from "../src/lib/characters/model.mjs";
const fail = (m, status = 400) => {
  throw Object.assign(new Error(m), { status });
};
const text = (v, max = 100) => {
  if (typeof v !== "string" || v.length > max) fail("Invalid character request.");
  return v;
};
async function membership(db, user, code) {
  const m = await db
    .prepare("SELECT * FROM library_members WHERE user_id=? AND code=?")
    .bind(user, code)
    .first();
  const row = await db.prepare("SELECT body FROM campaign_rooms WHERE code=?").bind(code).first();
  const room = row ? JSON.parse(row.body) : null;
  const seat = room?.seats.find((s) => s.id === m?.seat_id && s.token === m?.token);
  if (!seat) fail("Save an active campaign membership in My account first.", 403);
  return { room, seat, raw: row.body };
}
async function character(db, user, id, own = false) {
  const row = await db.prepare("SELECT * FROM play_characters WHERE id=?").bind(text(id)).first();
  if (!row) fail("Character not found.", 404);
  if (row.user_id !== user) {
    if (own || !row.campaign_code) fail("Character not found.", 404);
    const { seat } = await membership(db, user, row.campaign_code);
    if (seat.role !== "dm") fail("Character not found.", 404);
  }
  return row;
}
async function policy(db, code) {
  return !!(
    await db.prepare("SELECT manual_allowed FROM play_policies WHERE code=?").bind(code).first()
  )?.manual_allowed;
}
export async function handleCharacterPlay(db, user, path, body, url) {
  if (path === "sheets") {
    const rows = await db
      .prepare(
        "SELECT id,body,revision,campaign_code,purse_id,updated_at FROM play_characters WHERE user_id=? ORDER BY updated_at DESC",
      )
      .bind(user)
      .all();
    const ms = await db
      .prepare("SELECT code,name FROM library_members WHERE user_id=? AND archived=0")
      .bind(user)
      .all();
    const campaigns = [];
    for (const m of ms.results) {
      try {
        const { room, seat } = await membership(db, user, m.code);
        campaigns.push({
          code: m.code,
          name: m.name,
          role: seat.role,
          purses: room.table.purses
            .filter(
              (p) => p.kind === "character" && (seat.role === "dm" || seat.purseIds.includes(p.id)),
            )
            .map((p) => ({ id: p.id, name: p.name })),
        });
      } catch (e) {
        if (e.status !== 403) throw e;
      }
    }
    return {
      userId: user,
      characters: rows.results.map((r) => ({ ...r, body: JSON.parse(r.body) })),
      campaigns,
    };
  }
  if (path === "sheets/save") {
    const parsed = sheetSchema.safeParse(body.sheet);
    if (!parsed.success) fail(parsed.error.issues[0]?.message || "Check the sheet fields.");
    const sheet = parsed.data;
    const id = body.id ? text(body.id) : crypto.randomUUID();
    if (body.id) {
      await character(db, user, id, true);
      if (!Number.isSafeInteger(body.revision)) fail("Missing sheet revision.");
      const r = await db
        .prepare(
          "UPDATE play_characters SET body=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
        )
        .bind(JSON.stringify(sheet), Date.now(), id, user, body.revision)
        .run();
      if (!r.meta.changes)
        fail("This character changed on another device. Export your draft before reloading.", 409);
    } else
      await db
        .prepare("INSERT INTO play_characters(id,user_id,body,updated_at) VALUES (?,?,?,?)")
        .bind(id, user, JSON.stringify(sheet), Date.now())
        .run();
    return { id };
  }
  if (path === "sheets/detail") {
    const r = await character(db, user, body.id);
    let campaign = null,
      assignmentError = "";
    if (r.campaign_code) {
      try {
        const { room, seat } = await membership(db, user, r.campaign_code);
        const p = room.table.purses.find((p) => p.id === r.purse_id);
        if (!p || (seat.role !== "dm" && !seat.purseIds.includes(p.id)))
          fail("This character is no longer assigned to your campaign seat.", 403);
        campaign = {
          code: r.campaign_code,
          role: seat.role,
          manualAllowed: await policy(db, r.campaign_code),
          coins: p.coins,
          holdings: room.table.holdings.filter((h) => h.purseId === p.id),
        };
      } catch (e) {
        if (e.status !== 403) throw e;
        assignmentError = e.message;
      }
    }
    return {
      ...r,
      user_id: undefined,
      body: JSON.parse(r.body),
      editable: r.user_id === user,
      campaign,
      assignmentError,
    };
  }
  if (path === "sheets/assign") {
    const r = await character(db, user, body.id, true);
    const code = text(body.code, 16),
      purse = text(body.purseId);
    if (code) {
      const { room, seat } = await membership(db, user, code);
      if (
        !room.table.purses.some((p) => p.id === purse && p.kind === "character") ||
        (seat.role !== "dm" && !seat.purseIds.includes(purse))
      )
        fail("You may assign only a character controlled by your campaign seat.", 403);
      const taken = await db
        .prepare("SELECT id FROM play_characters WHERE campaign_code=? AND purse_id=? AND id<>?")
        .bind(code, purse, r.id)
        .first();
      if (taken) fail("That campaign character already has an account sheet.", 409);
    }
    try {
      const saved = await db
        .prepare(
          "UPDATE play_characters SET campaign_code=?,purse_id=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
        )
        .bind(code, code ? purse : "", Date.now(), r.id, user, body.revision)
        .run();
      if (!saved.meta.changes) fail("Character changed. Reload before assigning.", 409);
    } catch (e) {
      if (e.status) throw e;
      if (String(e.message).includes("UNIQUE"))
        fail("That campaign character already has an account sheet.", 409);
      throw e;
    }
    return { ok: true };
  }
  if (path === "sheets/campaign") {
    const code = text(body.code, 16);
    const { seat } = await membership(db, user, code);
    if (seat.role !== "dm") fail("Only the campaign DM can review the roster.", 403);
    const rows = await db
      .prepare(
        "SELECT id,body,purse_id FROM play_characters WHERE campaign_code=? ORDER BY updated_at DESC",
      )
      .bind(code)
      .all();
    return {
      characters: rows.results.map((r) => {
        const { name, portrait, classes, level, hp, maxHp, ac } = JSON.parse(r.body);
        return {
          id: r.id,
          name,
          purseId: r.purse_id,
          body: { name, portrait, classes, level, hp, maxHp, ac },
        };
      }),
      manualAllowed: await policy(db, code),
    };
  }
  if (path === "sheets/policy") {
    const code = text(body.code, 16);
    const { seat } = await membership(db, user, code);
    if (seat.role !== "dm") fail("Only the campaign DM can change manual-roll permission.", 403);
    if (typeof body.allowed !== "boolean") fail("Choose a manual-roll policy.");
    await db
      .prepare(
        "INSERT INTO play_policies(code,manual_allowed,updated_at) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET manual_allowed=excluded.manual_allowed,updated_at=excluded.updated_at",
      )
      .bind(code, body.allowed ? 1 : 0, Date.now())
      .run();
    return { ok: true };
  }
  if (path === "sheets/log") {
    const code = text(body.code || "", 16),
      id = text(body.id || "");
    if (code) await membership(db, user, code);
    else await character(db, user, id, true);
    const before = body.before === undefined ? Number.MAX_SAFE_INTEGER : body.before;
    if (!Number.isSafeInteger(before) || before < 1) fail("Invalid log page.");
    const rows = await db
      .prepare(
        `SELECT seq,body,created_at FROM play_rolls WHERE ${code ? "code=?" : "character_id=? AND code=''"} AND seq<? ORDER BY seq DESC LIMIT 51`,
      )
      .bind(code || id, before)
      .all();
    return {
      rolls: rows.results
        .slice(0, 50)
        .map((r) => ({ ...JSON.parse(r.body), seq: r.seq, at: r.created_at })),
      more: rows.results.length > 50,
    };
  }
  if (path === "sheets/roll") {
    const r = await character(db, user, body.id);
    let member = null;
    if (r.campaign_code) {
      member = await membership(db, user, r.campaign_code);
      if (member.seat.role !== "dm" && !member.seat.purseIds.includes(r.purse_id))
        fail("Your seat no longer controls this character.", 403);
    }
    const key = text(body.requestKey, 80);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) fail("Invalid roll receipt key.");
    const prior = await db
      .prepare("SELECT body FROM play_rolls WHERE user_id=? AND request_key=?")
      .bind(user, key)
      .first();
    if (prior) return JSON.parse(prior.body);
    if (r.revision !== body.revision)
      fail("Save or reload the current character before rolling.", 409);
    const s = JSON.parse(r.body);
    let spec;
    try {
      spec =
        body.kind === "custom"
          ? { label: text(body.label || "Custom roll", 120), formula: text(body.formula, 120) }
          : rollSpec(s, text(body.kind), text(body.key || ""));
      parseDice(spec.formula);
    } catch (e) {
      fail(e.message);
    }
    const manual = body.manual === true;
    if (manual && r.campaign_code && !(await policy(db, r.campaign_code)))
      fail("The DM has disabled manual rolls for this campaign.", 403);
    if (manual && (!Number.isSafeInteger(body.total) || Math.abs(body.total) > 100000))
      fail("Enter a whole-number manual total.");
    let result;
    try {
      result = manual
        ? { ...parseDice(spec.formula), dice: [], mode: "manual", total: body.total }
        : throwDice(spec.formula, body.mode || "normal");
    } catch (e) {
      fail(e.message);
    }
    const roll = {
      id: crypto.randomUUID(),
      characterId: r.id,
      character: s.name,
      actor: member?.seat.name || s.name,
      label: spec.label,
      formula: spec.formula,
      source: manual ? "manual" : "server",
      ...result,
    };
    // Persist a single receipt; campaign policy and membership snapshot must still be current.
    const saved = await db
      .prepare(
        `INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) SELECT ?,?,?,?,?,?,? WHERE (?='' OR EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)) AND (?=0 OR ?='' OR EXISTS(SELECT 1 FROM play_policies WHERE code=? AND manual_allowed=1)) ON CONFLICT(user_id,request_key) DO NOTHING`,
      )
      .bind(
        roll.id,
        user,
        r.id,
        r.campaign_code,
        key,
        JSON.stringify(roll),
        Date.now(),
        r.campaign_code,
        r.campaign_code,
        member?.raw || "",
        manual ? 1 : 0,
        r.campaign_code,
        r.campaign_code,
      )
      .run();
    const receipt = await db
      .prepare("SELECT body FROM play_rolls WHERE user_id=? AND request_key=?")
      .bind(user, key)
      .first();
    if (!receipt) fail("Campaign permissions changed. Refresh and retry.", 409);
    return JSON.parse(receipt.body);
  }
  return null;
}
