/** Immutable, private campaign documents. Complete exports hydrate the original records. */
const refPattern = /^resource-pack:[a-f0-9]{64}$/;
/** @param {any} value @param {(pack:any)=>any} transform @param {number} depth @returns {Promise<any>} */
async function visit(value, transform, depth = 0) {
  if (depth > 64) throw Error("Resource document nesting is invalid.");
  if (Array.isArray(value)) return Promise.all(value.map((v) => visit(v, transform, depth + 1)));
  if (!value || typeof value !== "object") return value;
  const result = { ...value };
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "resourceLibrary" &&
      child &&
      typeof child === "object" &&
      Array.isArray(child.packs)
    ) {
      result[key] = { ...child, packs: await Promise.all(child.packs.map(transform)) };
    } else if (key === "snapshot" && typeof child === "string") {
      let snapshot;
      try {
        snapshot = JSON.parse(child);
      } catch {
        continue;
      }
      const next = await visit(snapshot, transform, depth + 1);
      if (JSON.stringify(next) !== JSON.stringify(snapshot)) result[key] = JSON.stringify(next);
    } else if (key === "pack" && value.kind === "resource-pack-import") {
      result[key] = await transform(child);
    } else result[key] = await visit(child, transform, depth + 1);
  }
  return result;
}
/** @param {unknown} value */
export async function encodeRoomResources(value) {
  const documents = new Map();
  const result = await visit(value, async (pack) => {
    if (pack?.format !== "lootsplit.resource-pack")
      throw Error("Invalid campaign resource document.");
    const body = JSON.stringify(pack);
    if (new TextEncoder().encode(body).length > 1_500_000)
      throw Error(
        "A resource pack exceeds 1.5 MB. Keep the original export and split it into separate packs.",
      );
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const reference =
      "resource-pack:" +
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    documents.set(reference, { reference, body });
    return { resourceReference: reference };
  });
  return { value: result, documents: [...documents.values()] };
}
/** @template T
 * @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {string} code @param {T} value @returns {Promise<T>} */
export async function hydrateRoomResources(db, code, value) {
  const pending = new Set();
  await visit(value, (pack) => {
    if (refPattern.test(pack?.resourceReference) && Object.keys(pack).length === 1)
      pending.add(pack.resourceReference);
    return pack;
  });
  if (!pending.size) return value;
  const refs = [...pending],
    documents = new Map();
  for (let offset = 0; offset < refs.length; offset += 80) {
    const wanted = refs.slice(offset, offset + 80);
    const rows = await db
      .prepare(
        `SELECT reference,body FROM campaign_resource_documents WHERE code=? AND reference IN (${wanted.map(() => "?").join(",")})`,
      )
      .bind(code, ...wanted)
      .all();
    for (const row of rows.results) documents.set(row.reference, row.body);
  }
  return visit(value, (pack) => {
    if (!refPattern.test(pack?.resourceReference) || Object.keys(pack).length !== 1) return pack;
    const body = documents.get(pack.resourceReference);
    if (typeof body !== "string")
      throw Error(
        "A campaign resource pack is missing. Keep the original recovery export; the campaign was not changed.",
      );
    return JSON.parse(body);
  });
}
/** @param {NonNullable<ReturnType<typeof import('../src/lib/quire/room-store.server.ts').database>>} db
 * @param {{code:string;revision:number}} room
 * @param {{body:string;documents?:{reference:string;body:string}[]}} encoded */
export async function roomResourceStatements(db, room, encoded) {
  if (!encoded.documents?.length) return [];
  const present = await db
    .prepare("SELECT reference FROM campaign_resource_documents WHERE code=?")
    .bind(room.code)
    .all();
  const existing = new Set(present.results.map((row) => row.reference));
  return encoded.documents
    .filter((doc) => !existing.has(doc.reference))
    .map((doc) =>
      db
        .prepare(
          "INSERT INTO campaign_resource_documents(code,reference,body) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM campaign_rooms WHERE code=? AND revision=? AND body=?) ON CONFLICT(code,reference) DO NOTHING",
        )
        .bind(room.code, doc.reference, doc.body, room.code, room.revision, encoded.body),
    );
}
