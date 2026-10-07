import { roleOf, staffCommitGuard } from "./members.mjs";
const statuses = ["new", "reviewing", "planned", "fixed", "closed"];
const areas = [
  "general",
  "accounts",
  "campaigns",
  "multiplayer",
  "inventory",
  "shops",
  "imports",
  "android",
  "website",
];
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const text = (v, max, required = false) => {
  if (typeof v !== "string" || v.trim().length > max || (required && !v.trim()))
    fail("Please check the report fields.");
  return v.trim();
};
const staff = async (db, id) => ["owner", "admin"].includes(await roleOf(db, id));
export async function createBugReport(db, userId, body) {
  const key = text(body.requestKey, 80, true);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) fail("Invalid submission identifier.");
  const title = text(body.title, 120, true),
    description = text(body.description, 4000, true);
  const steps = text(body.steps, 4000),
    expected = text(body.expected, 2000);
  if (!areas.includes(body.area)) fail("Choose a report category.");
  const diagnostics = {};
  if (body.diagnostics != null) {
    if (typeof body.diagnostics !== "object" || Array.isArray(body.diagnostics))
      fail("Invalid diagnostics.");
    for (const field of ["appVersion", "platform", "browser", "viewport"]) {
      if (body.diagnostics[field] !== undefined)
        diagnostics[field] = text(body.diagnostics[field], field === "browser" ? 350 : 80);
    }
  }
  // Retried submissions return the same receipt even after reaching the daily allowance.
  const prior = await db
    .prepare("SELECT id FROM bug_reports WHERE user_id=? AND request_key=?")
    .bind(userId, key)
    .first();
  if (prior) return prior;
  const now = Date.now(),
    id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO bug_reports(id,user_id,request_key,title,area,description,steps,expected,diagnostics,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM bug_reports WHERE user_id=? AND created_at>?)<5
    ON CONFLICT(user_id,request_key) DO NOTHING`,
    )
    .bind(
      id,
      userId,
      key,
      title,
      body.area,
      description,
      steps,
      expected,
      JSON.stringify(diagnostics),
      now,
      now,
      userId,
      now - 86400000,
    )
    .run();
  const saved = await db
    .prepare("SELECT id FROM bug_reports WHERE user_id=? AND request_key=?")
    .bind(userId, key)
    .first();
  if (!saved) fail("You can submit up to five reports in 24 hours. Please try again later.", 429);
  return saved;
}
export async function listBugReports(db, userId, url) {
  const all = url.searchParams.get("scope") === "all";
  if (all && !(await staff(db, userId))) fail("Owner or administrator access is required.", 403);
  const status = url.searchParams.get("status") || "all";
  if (status !== "all" && !statuses.includes(status)) fail("Invalid status filter.");
  const raw = Number(url.searchParams.get("offset") || 0);
  if (!Number.isSafeInteger(raw) || raw < 0 || raw > 1000000) fail("Invalid page.");
  const clauses = [],
    args = [];
  if (!all) {
    clauses.push("r.user_id=?");
    args.push(userId);
  }
  if (status !== "all") {
    clauses.push("r.status=?");
    args.push(status);
  }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  const rows = await db
    .prepare(
      `SELECT r.id,r.title,r.area,r.status,r.priority,r.created_at,r.updated_at FROM bug_reports r${where} ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET ?`,
    )
    .bind(...args, raw)
    .all();
  return { reports: rows.results.slice(0, 20), hasMore: rows.results.length > 20 };
}
export async function bugReportDetail(db, userId, id) {
  id = text(id, 80, true);
  const all = await staff(db, userId);
  const row = await db
    .prepare(
      `SELECT r.id,r.title,r.area,r.description,r.steps,r.expected,r.diagnostics,r.status,r.priority,r.response,r.revision,r.created_at,r.updated_at
    FROM bug_reports r WHERE r.id=?${all ? "" : " AND r.user_id=?"}`,
    )
    .bind(...(all ? [id] : [id, userId]))
    .first();
  if (!row) fail("Report not found.", 404);
  const history = await db
    .prepare(
      "SELECT status,priority,response,created_at FROM bug_report_audit WHERE report_id=? ORDER BY revision DESC LIMIT 30",
    )
    .bind(id)
    .all();
  return { ...row, diagnostics: JSON.parse(row.diagnostics), history: history.results };
}
export async function updateBugReport(db, userId, body, sessionId) {
  if (!(await staff(db, userId))) fail("Owner or administrator access is required.", 403);
  const id = text(body.id, 80, true),
    response = text(body.response, 2000);
  if (
    !statuses.includes(body.status) ||
    !["low", "normal", "high", "urgent"].includes(body.priority) ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    fail("Invalid report update.");
  const marker = crypto.randomUUID(),
    now = Date.now();
  const guard = await staffCommitGuard(db, userId, sessionId, ["owner", "admin"]);
  const result = await db.batch([
    db
      .prepare(
        `UPDATE bug_reports SET status=?,priority=?,response=?,revision=revision+1,last_action=?,updated_at=? WHERE id=? AND revision=? AND ${guard.sql}`,
      )
      .bind(body.status, body.priority, response, marker, now, id, body.revision, ...guard.binds),
    db
      .prepare(
        "INSERT INTO bug_report_audit(id,report_id,actor_id,status,priority,response,created_at,revision) SELECT last_action,id,?,status,priority,response,updated_at,revision FROM bug_reports WHERE id=? AND last_action=?",
      )
      .bind(userId, id, marker),
  ]);
  if (result[0].meta.changes !== 1)
    fail("This report changed or is unavailable. Reopen it before saving.", 409);
  return { ok: true };
}
