import assert from "node:assert/strict";

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
