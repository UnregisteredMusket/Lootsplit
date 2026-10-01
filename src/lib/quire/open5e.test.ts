import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenPage, openCatalogItem, openUrl, type OpenQuery } from "./open5e.ts";
import { fantasyBatch, NAME_STYLES } from "./fantasy-names.ts";
import { rngFrom } from "./names.ts";
import type { LexemeKind } from "./types.ts";
const query: OpenQuery = { kind: "items", edition: "srd-2014", query: "Longsword", page: 1 };
const sword = {
  key: "srd_longsword",
  name: "Longsword",
  desc: "A sword.",
  cost: "15.00",
  category: { name: "Weapon" },
  document: { key: "srd-2014", name: "System Reference Document 5.1" },
};
test("Open5e fixes endpoint and applies the actual source filter", () => {
  const url = new URL(openUrl(query));
  assert.equal(url.hostname, "api.open5e.com");
  assert.equal(url.searchParams.get("document__key__in"), "srd-2014");
  assert.throws(() => openUrl({ ...query, kind: "../documents" as never }));
  assert.throws(() => openUrl({ ...query, page: 0 }));
});
test("Open5e rejects mixed sources and converts gold prices without losing attribution", () => {
  const data = normalizeOpenPage(
    { count: 2, next: null, results: [sword, { ...sword, document: { key: "srd-2024" } }] },
    query,
  );
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0]!.copper, 1500);
  const item = openCatalogItem(data.entries[0]!, 2000, "smith");
  assert.equal(item.baseCopper, 2000);
  assert.equal(item.name, "Longsword (2014)");
  assert.match(item.notes, /Creative Commons/);
  assert.match(item.notes, /srd_longsword/);
});
test("missing and placeholder magic prices require an explicit price", () => {
  for (const cost of [undefined, null, "", "0.00", "invalid"]) {
    const entry = normalizeOpenPage(
      { count: 1, results: [{ ...sword, cost }] },
      { ...query, kind: "magicitems" },
    ).entries[0]!;
    assert.equal(entry.copper, null);
    assert.throws(() => openCatalogItem(entry, NaN, "curios"));
  }
  assert.equal(
    normalizeOpenPage({ count: 1, results: [{ ...sword, cost: "0.00" }] }, query).entries[0]!
      .copper,
    0,
  );
});
test("spell reference retains components, range and concentration", () => {
  const e = normalizeOpenPage(
    {
      count: 1,
      results: [
        {
          ...sword,
          range_text: "150 feet",
          verbal: true,
          somatic: true,
          material: true,
          material_specified: "Sulfur",
          concentration: true,
          level: 3,
        },
      ],
    },
    { ...query, kind: "spells" },
  ).entries[0]!;
  assert.ok(e.facts.includes("Range: 150 feet"));
  assert.ok(e.facts.includes("Concentration required"));
  assert.ok(e.facts.includes("Components: V, S, M (Sulfur)"));
  assert.throws(() => openCatalogItem(e, 10, "general"));
});
test("offline name generation is deterministic, varied and bounded across all kinds", () => {
  for (const style of NAME_STYLES)
    for (const kind of [
      "person",
      "place",
      "shop",
      "region",
      "country",
      "continent",
    ] as LexemeKind[]) {
      const a = fantasyBatch(kind, style.value, 6, rngFrom(123));
      assert.equal(a.length, 6);
      assert.equal(new Set(a).size, 6);
      assert.deepEqual(a, fantasyBatch(kind, style.value, 6, rngFrom(123)));
      assert.ok(a.every((n) => n.length > 3 && n.length < 90));
    }
  assert.equal(fantasyBatch("person", "frontier", 999, rngFrom(42)).length, 12);
  assert.equal(fantasyBatch("shop", "frontier", 6, () => 0).length, 1);
});

test('imported source notes survive generated shop stock', async () => {
  const {composeShelf}=await import('./compose.ts');
  const {DEFAULT_REALM}=await import('./scale.ts');
  const entry=normalizeOpenPage({count:1,results:[sword]},query).entries[0]!;
  const item=openCatalogItem(entry,1500,'smith');
  const shelf=composeShelf([item],{category:'smith',wealth:'modest',flags:{common:true,uncommon:false,rare:false,magic:false},priceScale:1,depth:1,realm:DEFAULT_REALM},rngFrom(1));
  assert.equal(shelf[0]!.notes,item.notes);
});

test('shared conditions select only the requested SRD description',()=>{
 const q={...query,kind:'conditions' as const};
 const payload={count:1,results:[{key:'blinded',name:'Blinded',document:{key:'core'},descriptions:[{document:'a5e-ag',desc:'Third-party rules'},{document:'srd-2014',desc:'2014 condition'},{document:'srd-2024',desc:'2024 condition'}]}]};
 assert.equal(normalizeOpenPage(payload,q).entries[0]!.description,'2014 condition');
 assert.equal(normalizeOpenPage(payload,{...q,edition:'srd-2024'}).entries[0]!.description,'2024 condition');
 assert.equal(new URL(openUrl(q)).searchParams.get('document__key__in'),'core');
});
