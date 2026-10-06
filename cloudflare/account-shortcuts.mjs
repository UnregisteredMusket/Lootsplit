import { normalizeShortcuts } from "../src/lib/quire/shortcuts.mjs";
export async function accountShortcuts(db, userId, method, input) {
  const role = input.role;
  if (!["dm", "player"].includes(role))
    throw Object.assign(Error("Choose a shortcut role."), { status: 400 });
  if (method === "POST") {
    if (!Number.isSafeInteger(input.revision) || input.revision < 0)
      throw Object.assign(Error("Invalid shortcut revision."), { status: 400 });
    const body = JSON.stringify(normalizeShortcuts(input.items, role));
    const result =
      input.revision === 0
        ? await db
            .prepare(
              "INSERT INTO account_shortcuts (user_id,role,body,revision) VALUES (?,?,?,1) ON CONFLICT(user_id,role) DO NOTHING",
            )
            .bind(userId, role, body)
            .run()
        : await db
            .prepare(
              "UPDATE account_shortcuts SET body=?,revision=revision+1 WHERE user_id=? AND role=? AND revision=?",
            )
            .bind(body, userId, role, input.revision)
            .run();
    if (!result.meta.changes)
      throw Object.assign(Error("Shortcuts changed on another device. Reload before saving."), {
        status: 409,
      });
  }
  const row = await db
    .prepare("SELECT body,revision FROM account_shortcuts WHERE user_id=? AND role=?")
    .bind(userId, role)
    .first();
  return {
    items: normalizeShortcuts(row ? JSON.parse(row.body) : null, role),
    revision: row?.revision || 0,
  };
}
