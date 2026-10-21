/**
 * Client-only stable React keys for editable sheet rows that have no saved id.
 * Keys live beside the rows (never in saved data) and follow additions and removals.
 */
export function syncRowKeys(keys: string[], length: number, make: () => string): string[] {
  while (keys.length < length) keys.push(make());
  if (keys.length > length) keys.length = length;
  return keys;
}

export function removeRowKey(keys: string[], index: number): void {
  if (index >= 0 && index < keys.length) keys.splice(index, 1);
}
