import test from "node:test";
import assert from "node:assert/strict";
import { readPartySheetLinks, writePartySheetLink } from "./party-sheet-links.ts";
function storage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    rows,
  };
}
test("party links select explicit identities, remain isolated by account/campaign, and survive reload", () => {
  const s = storage();
  writePartySheetLink("owner", "campaign-a", "sheet-a", "hero", ["hero"], s);
  assert.deepEqual(readPartySheetLinks("owner", "campaign-a", s), [
    { sheetId: "sheet-a", purseId: "hero" },
  ]);
  assert.deepEqual(readPartySheetLinks("other-owner", "campaign-a", s), []);
  assert.deepEqual(readPartySheetLinks("owner", "campaign-b", s), []);
  assert.deepEqual(readPartySheetLinks("", "campaign-a", s), []);
  assert.throws(
    () => writePartySheetLink("owner", "campaign-a", "sheet-b", "hero", ["hero"], s),
    /already has/,
  );
  assert.throws(
    () => writePartySheetLink("owner", "campaign-a", "sheet-b", "someone-else", ["hero"], s),
    /controlled/,
  );
  writePartySheetLink("owner", "campaign-a", "sheet-a", "hero-2", ["hero-2"], s);
  assert.deepEqual(readPartySheetLinks("owner", "campaign-a", s), [
    { sheetId: "sheet-a", purseId: "hero-2" },
  ]);
  writePartySheetLink("owner", "campaign-a", "sheet-a", "", [], s);
  assert.deepEqual(readPartySheetLinks("owner", "campaign-a", s), []);
});
test("malformed or duplicate saved references never create ambiguous party ownership", () => {
  const s = storage();
  writePartySheetLink("owner", "campaign", "sheet", "hero", ["hero"], s);
  const key = [...s.rows.keys()][0]!;
  for (const value of ["broken", "null", "{}", '[{"sheetId":3,"purseId":"hero"}]']) {
    s.setItem(key, value);
    assert.deepEqual(readPartySheetLinks("owner", "campaign", s), []);
  }
  s.setItem(
    key,
    JSON.stringify([
      { sheetId: "a", purseId: "x" },
      { sheetId: "b", purseId: "x" },
      { sheetId: "a", purseId: "y" },
    ]),
  );
  assert.deepEqual(readPartySheetLinks("owner", "campaign", s), [{ sheetId: "a", purseId: "x" }]);
  assert.throws(() => writePartySheetLink("", "campaign", "sheet", "hero", ["hero"], s));
});
