import { getArticle, quireDb } from "./db.ts";

export type Handout = { id: string; title: string; text: string };

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not save the handout."));
  });
}

export function readHandouts(value: unknown): Handout[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { handouts?: unknown }).handouts) ? (value as { handouts: unknown[] }).handouts : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<Handout>;
      if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.text !== "string") return null;
      return { id: row.id, title: row.title.slice(0, 160), text: row.text.slice(0, 8000) };
    })
    .filter((item): item is Handout => item !== null);
}

export async function loadHandouts(): Promise<Handout[]> {
  const db = await quireDb();
  const row = await request<unknown>(db.transaction("meta").objectStore("meta").get("handouts"));
  return readHandouts(row);
}

export async function saveHandouts(handouts: Handout[]): Promise<void> {
  const db = await quireDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ id: "handouts", handouts: readHandouts(handouts) });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the handout."));
  });
}

export async function toggleHandout(articleId: string): Promise<boolean> {
  const article = await getArticle(articleId);
  if (!article) throw new Error("That entry is gone.");
  const current = await loadHandouts();
  const on = current.some((item) => item.id === articleId);
  const next = on
    ? current.filter((item) => item.id !== articleId)
    : [...current, { id: article.id, title: article.title, text: article.text.slice(0, 8000) }];
  await saveHandouts(next);
  return !on;
}
