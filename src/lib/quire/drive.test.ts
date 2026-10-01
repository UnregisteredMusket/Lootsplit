import assert from "node:assert/strict";
import test from "node:test";
import { driveFileId, driveFiles, driveName } from "./drive.ts";

test("reads a folder id from a Drive result", () => {
  assert.equal(driveFileId({ id: "abc" }), "abc");
  assert.equal(driveFileId({ files: [{ file_id: "folder-1", name: "Lootsplit" }] }), "folder-1");
  assert.deepEqual(driveFiles({ files: [{ file_id: "folder-1", name: "Lootsplit" }] }), [{ id: "folder-1", name: "Lootsplit" }]);
});

test("names a Drive copy with its kind", () => {
  assert.match(driveName("save", "The company"), /^save-The-company-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
});
