import { hydrateCampaignCharacters, campaignBody } from "./campaign-characters.mjs";
import { statsOnly, editCharacter } from "../src/lib/characters/campaign-sheet.mjs";
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
  if (!seat || room.closed) fail("Save an active campaign membership in My account first.", 403);
  await hydrateCampaignCharacters(db, room);
  return { room, seat, raw: JSON.stringify(room) };
}
async function character(db, user, id, own = false) {
  if (typeof id === "string" && id.startsWith("campaign:")) {
    const [, code, ...parts] = id.split(":"),
      purseId = parts.join(":");
    const { room, seat } = await membership(db, user, text(code, 16));
    const p = room.table.purses.find((p) => p.id === purseId && p.kind === "character");
    if (!p || (seat.role !== "dm" && !seat.purseIds.includes(p.id)))
      fail("Character not found.", 404);
    if (own && seat.role === "dm" && p.sheetReadOnlyForDm)
      fail("Only the profile owner can edit this character sheet.", 403);
    return {
      id,
      user_id: seat.role === "dm" && p.sheetReadOnlyForDm ? "profile-owner" : user,
      campaign_code: code,
      purse_id: p.id,
      revision: p.sheetRevision || 0,
      body: JSON.stringify(campaignBody(room, p.id)),
      canonical: true,
    };
  }
  const row = await db.prepare("SELECT * FROM play_characters WHERE id=?").bind(text(id)).first();
  if (!row) fail("Character not found.", 404);
  if (row.campaign_code) {
    const { room, seat } = await membership(db, user, row.campaign_code);
    if (
      !room.table.purses.some((p) => p.id === row.purse_id) ||
      (seat.role !== "dm" && !seat.purseIds.includes(row.purse_id))
    )
      fail("This character is no longer assigned to your campaign seat.", 403);
  }
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
export async function handleCharacterPlay(db, user, path, body, url, approval = null) {
  if (path === "sheets/imports") {
    const { seat } = await membership(db, user, text(body.code, 16));
    const rows = await db.prepare(seat.role === "dm"
      ? "SELECT id,character_id,purse_id,body,status,created_at FROM character_imports WHERE code=? ORDER BY (status='pending') DESC,created_at DESC LIMIT 100"
      : "SELECT id,character_id,purse_id,body,status,created_at FROM character_imports WHERE code=? AND user_id=? ORDER BY created_at DESC LIMIT 100")
      .bind(...(seat.role === "dm" ? [body.code] : [body.code, user])).all();
    return { requests: rows.results.map((r) => ({ ...r, body: JSON.parse(r.body) })) };
  }
  if (path === "sheets/review-import") {
    const request = await db.prepare("SELECT * FROM character_imports WHERE id=?").bind(text(body.id)).first();
    if (!request) fail("Import request not found.", 404);
    const reviewer = await membership(db, user, request.code);
    if (reviewer.seat.role !== "dm") fail("Only the campaign DM can review imports.", 403);
    if (!["approved", "denied"].includes(body.decision)) fail("Choose approve or deny.");
    if (request.status !== "pending") {
      if (request.status !== body.decision) fail("This import was already reviewed.", 409);
      return { ok: true, status: request.status };
    }
    if (body.decision === "denied") {
      const result = await db.prepare("UPDATE character_imports SET status='denied',reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)")
        .bind(Date.now(), user, request.id, request.code, reviewer.raw).run();
      if (!result.meta.changes) fail("Campaign or request changed. Refresh before reviewing.", 409);
      return { ok: true, status: "denied" };
    }
    return handleCharacterPlay(db, request.user_id, "sheets/assign", { id: request.character_id, code: request.code, purseId: request.purse_id, revision: request.source_revision }, url, { ...request, reviewer: user, reviewerRaw: reviewer.raw });
  }
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
    const characters = [];
    for (const r of rows.results) {
      let body = JSON.parse(r.body);
      if (r.campaign_code) {
        try {
          const { room, seat } = await membership(db, user, r.campaign_code);
          if (seat.role !== "dm" && !seat.purseIds.includes(r.purse_id)) continue;
          if (!room.table.purses.some((p) => p.id === r.purse_id)) continue;
          body = campaignBody(room, r.purse_id);
        } catch (e) {
          if (e.status !== 403 && e.status !== 404) throw e;
          continue;
        }
      }
      characters.push({ ...r, body });
    }
    return {
      userId: user,
      characters,
      campaigns,
    };
  }
  if (path === "sheets/save") {
    const parsed = sheetSchema.safeParse(body.sheet);
    if (!parsed.success) fail(parsed.error.issues[0]?.message || "Check the sheet fields.");
    const sheet = parsed.data;
    const id = body.id ? text(body.id) : crypto.randomUUID();
    if (body.id) {
      const existing = await character(db, user, id, true);
      if (existing.campaign_code) {
        const { room, seat, raw } = await membership(db, user, existing.campaign_code);
        if (room.viewOnly && seat.role === "player")
          fail("The session has ended. This room is view-only until the DM resumes play.", 403);
        const p = room.table.purses.find((p) => p.id === existing.purse_id);
        if (!p || (seat.role !== "dm" && !seat.purseIds.includes(p.id)))
          fail("Your seat no longer controls this character.", 403);
        if (!room.live && room.seats[room.turn]?.id !== seat.id)
          fail("Wait for your campaign turn before saving.", 409);
        if (Object.values(room.drafts || {}).some((d) => d.length))
          fail("Submit or discard pending turns before editing through an account profile.", 409);
        if ((p.sheetRevision || 0) !== body.revision)
          fail("Character changed. Reload before saving.", 409);
        if (!body.before)
          fail("Reload the character before saving; the financial baseline is required.", 409);
        try {
          editCharacter(
            room.table,
            seat,
            { purseId: p.id, before: body.before || campaignBody(room, p.id), sheet },
            crypto.randomUUID(),
          );
        } catch (e) {
          fail(e.message, 409);
        }
        room.revision++;
        const saved = await db
          .prepare("UPDATE campaign_rooms SET body=?,revision=? WHERE code=? AND body=?")
          .bind(JSON.stringify(room), room.revision, room.code, raw)
          .run();
        if (!saved.meta.changes) fail("Campaign changed. Reload and retry.", 409);
        return { id };
      }
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
      assignmentError = "",
      projected = JSON.parse(r.body),
      revision = r.revision;
    if (r.campaign_code) {
      const { room, seat } = await membership(db, user, r.campaign_code);
      const p = room.table.purses.find((p) => p.id === r.purse_id);
      if (!p || (seat.role !== "dm" && !seat.purseIds.includes(p.id)))
        fail("This character is no longer assigned to your campaign seat.", 403);
      projected = campaignBody(room, p.id);
      revision = p.sheetRevision || 0;
      campaign = {
        code: r.campaign_code,
        role: seat.role,
        editingAllowed: seat.role === "dm" || p.editingAllowed === true,
        permissions: p.permissions || {},
        manualAllowed: await policy(db, r.campaign_code),
        coins: p.coins,
        holdings: room.table.holdings.filter((h) => h.purseId === p.id),
      };
    }
    return {
      ...r,
      user_id: undefined,
      body: projected,
      revision,
      assignmentRevision: r.revision,
      editable: r.user_id === user,
      campaign,
      assignmentError,
    };
  }
  if (path === "sheets/assign") {
    const r = await character(db, user, body.id, true);
    if (r.canonical) fail("This character already belongs to its campaign.");
    if (r.revision !== body.revision) fail("Character changed. Reload before assigning.", 409);
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
    let source = JSON.parse(r.body),
      previous = null;
    if (r.campaign_code) {
      try {
        previous = await membership(db, user, r.campaign_code);
        if (previous.seat.role === "dm" || previous.seat.purseIds.includes(r.purse_id))
          source = campaignBody(previous.room, r.purse_id);
      } catch (e) {
        if (e.status !== 403) throw e;
      }
    }
    let target = null;
    if (code) {
      target = previous?.room.code === code ? previous : await membership(db, user, code);
      const { room, seat } = target;
      if (room.viewOnly && seat.role === "player")
        fail("The session has ended. This room is view-only until the DM resumes play.", 403);
      const p = room.table.purses.find((p) => p.id === purse);
      if (seat.role === "player" && !approval) {
        const key = text(body.requestKey, 100);
        if (!key) fail("Missing import retry identifier.");
        const prior = await db.prepare("SELECT * FROM character_imports WHERE id=?").bind(key).first();
        if (prior) {
          if (prior.user_id !== user || prior.character_id !== r.id || prior.code !== code || prior.purse_id !== purse) fail("Import identifier already used.", 409);
          return { ok: true, pending: prior.status === "pending", status: prior.status };
        }
        const pending = await db.prepare("SELECT id FROM character_imports WHERE user_id=? AND code=? AND purse_id=? AND status='pending'").bind(user, code, purse).first();
        if (pending) fail("An import is already awaiting DM review for this character.", 409);
        await db.prepare("INSERT INTO character_imports(id,user_id,character_id,code,purse_id,source_revision,target_revision,seat_id,seat_token,session_id,body,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?)")
          .bind(key, user, r.id, code, purse, r.revision, p.sheetRevision || 0, seat.id, seat.token, room.sessionId || "", JSON.stringify(source), Date.now()).run();
        return { ok: true, pending: true, status: "pending" };
      }
      if (approval) {
        if (target.raw !== approval.reviewerRaw || seat.id !== approval.seat_id || seat.token !== approval.seat_token || (room.sessionId || "") !== approval.session_id || (p.sheetRevision || 0) !== approval.target_revision || JSON.stringify(source) !== approval.body)
          fail("Character, session or access changed since submission. Deny this request and ask for a fresh import.", 409);
      }
      const actingSeat = approval ? room.seats.find((s) => s.role === "dm") : seat;
      if (!room.live && room.seats[room.turn]?.id !== actingSeat?.id)
        fail("Wait for your campaign turn before assigning.", 409);
      if (Object.values(room.drafts || {}).some((d) => d.length))
        fail("Submit or discard pending turns before assigning.", 409);
      // Approval authorizes the reviewed stats, never account wealth or equipment.
      const existing = campaignBody(room, purse);
      p.sheet = statsOnly({
        ...source,
        ...(seat.role === "player" && !approval
          ? { scores: { ...source.scores, cha: existing.scores.cha } }
          : {}),
      });
      p.name = source.name;
      p.portrait = source.portrait || undefined;
      p.profileId = r.id;
      p.sheetReadOnlyForDm = seat.role !== "dm";
      p.sheetRevision = (p.sheetRevision || 0) + 1;
      room.revision++;
    }
    let detached = null;
    if (previous && (r.campaign_code !== code || r.purse_id !== purse)) {
      const prior = previous.room.table.purses.find(
        (p) => p.id === r.purse_id && p.profileId === r.id,
      );
      if (prior && (previous.seat.role === "dm" || previous.seat.purseIds.includes(prior.id))) {
        delete prior.profileId;
        delete prior.sheetReadOnlyForDm;
        if (previous !== target) {
          previous.room.revision++;
          detached = previous;
        }
      }
    }
    try {
      const update = db
        .prepare(
          "UPDATE play_characters SET body=?,campaign_code=?,purse_id=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND (?='' OR EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)) AND (?='' OR EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)) AND (?='' OR EXISTS(SELECT 1 FROM character_imports WHERE id=? AND status='pending'))",
        )
        .bind(
          JSON.stringify({
            ...source,
            coins: JSON.parse(r.body).coins,
            equipment: JSON.parse(r.body).equipment,
          }),
          code,
          code ? purse : "",
          Date.now(),
          r.id,
          user,
          body.revision,
          code,
          code,
          target?.raw || "",
          detached?.room.code || "",
          detached?.room.code || "",
          detached?.raw || "",
          approval?.id || "",
          approval?.id || "",
        );
      const statements = [update];
      if (target)
        statements.push(
          db
            .prepare(
              "UPDATE campaign_rooms SET body=?,revision=? WHERE code=? AND body=? AND EXISTS(SELECT 1 FROM play_characters WHERE id=? AND campaign_code=? AND purse_id=? AND revision=?)",
            )
            .bind(
              JSON.stringify(target.room),
              target.room.revision,
              code,
              target.raw,
              r.id,
              code,
              purse,
              body.revision + 1,
            ),
        );
      if (detached)
        statements.push(
          db
            .prepare(
              "UPDATE campaign_rooms SET body=?,revision=? WHERE code=? AND body=? AND EXISTS(SELECT 1 FROM play_characters WHERE id=? AND campaign_code=? AND purse_id=? AND revision=?)",
            )
            .bind(
              JSON.stringify(detached.room),
              detached.room.revision,
              detached.room.code,
              detached.raw,
              r.id,
              code,
              code ? purse : "",
              body.revision + 1,
            ),
        );
      if (approval) statements.push(db.prepare("UPDATE character_imports SET status='approved',reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM play_characters WHERE id=? AND campaign_code=? AND purse_id=? AND revision=?) AND EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND body=?)")
        .bind(Date.now(), approval.reviewer, approval.id, r.id, code, purse, body.revision + 1, code, JSON.stringify(target.room)));
      const result = await db.batch(statements);
      if (result.some((x) => !x.meta.changes))
        fail("Character or campaign changed. Reload before assigning.", 409);
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
    const { room, seat } = await membership(db, user, code);
    if (seat.role !== "dm") fail("Only the campaign DM can review the roster.", 403);
    return {
      characters: room.table.purses
        .filter((p) => p.kind === "character")
        .map((p) => {
          const { name, portrait, classes, level, hp, maxHp, ac } = campaignBody(room, p.id);
          return {
            id: `campaign:${code}:${p.id}`,
            name,
            purseId: p.id,
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
      if (member.room.viewOnly && member.seat.role === "player")
        fail("The session has ended. This room is view-only until the DM resumes play.", 403);
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
    const canonicalPurse = member?.room.table.purses.find((p) => p.id === r.purse_id);
    if ((canonicalPurse ? canonicalPurse.sheetRevision || 0 : r.revision) !== body.revision)
      fail("Save or reload the current character before rolling.", 409);
    const s = member ? campaignBody(member.room, r.purse_id) : JSON.parse(r.body);
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
