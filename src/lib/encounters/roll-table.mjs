// Shared by device encounters and the hosted encounter service.
/** @param {{id: string, name: string, entries: {weight: number, loot: {name: string}}[]}} table
 * @param {boolean} manual @param {unknown} total @param {string} source */
export function rollLootTable(table, manual, total, source) {
  const weight = table.entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isSafeInteger(weight) || weight < 1 || weight > 4294967296)
    throw new Error("The loot table needs valid weighted entries.");
  let die;
  if (manual) {
    if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 1 || total > weight)
      throw new Error(`Enter a whole-number physical table total from 1 to ${weight}.`);
    die = total;
  } else {
    const ceiling = Math.floor(4294967296 / weight) * weight;
    const bytes = new Uint32Array(1);
    do { crypto.getRandomValues(bytes); } while (bytes[0] >= ceiling);
    die = (bytes[0] % weight) + 1;
  }
  let remaining = die;
  let selected = table.entries.length - 1;
  for (let i = 0; i < table.entries.length; i++) {
    remaining -= table.entries[i].weight;
    if (remaining <= 0) { selected = i; break; }
  }
  return {
    label: table.name, formula: `1d${weight}`, source: manual ? "manual" : source,
    dice: manual ? [] : [die], total: die, modifier: 0, selected, tableId: table.id,
    resultName: table.entries[selected].loot.name,
  };
}
