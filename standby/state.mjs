import assert from "node:assert/strict";
import { deploymentOrigins } from "../src/lib/deployment/origins.mjs";

/** The standby must never claim the primary website, native API or a legacy host as its own origin. */
export function standbyOrigin(value) {
  const origin = new URL(value).origin;
  const refused = [deploymentOrigins.website, deploymentOrigins.nativeApi, ...deploymentOrigins.legacy];
  if (!origin.startsWith("https://") || refused.includes(origin)) throw new Error("Set the HTTPS standby origin");
  return origin;
}

export async function validateActivation(client, config, manifest) {
  assert.match(config.STANDBY_SNAPSHOT_ID || "", /^[a-f0-9]{32}$/);
  assert.match(config.PRIMARY_FENCE_ID || "", /^[a-f0-9]{64}$/);
  const { rows } = await client.execute("SELECT * FROM lootsplit_recovery WHERE id=1");
  assert.equal(rows.length, 1, "No verified restore metadata");
  const snapshot = rows[0];
  assert.equal(snapshot.snapshot_id, config.STANDBY_SNAPSHOT_ID, "Wrong snapshot");
  assert.equal(snapshot.migrations_hash, manifest.migrationsHash, "Database schema does not match this release");
  assert.equal(snapshot.fence_id, config.PRIMARY_FENCE_ID, "Primary fencing has not been confirmed for this restore");
  const migrations = await client.execute("SELECT name FROM d1_migrations ORDER BY name");
  assert.deepEqual(migrations.rows.map((row) => row.name), manifest.migrations, "Database migrations differ");
}
