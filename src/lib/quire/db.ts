import type { Article, Book, DraftArticle } from "./types.ts";

import { isEphemeralCampaign } from "./guest-storage.ts";
const DB_VERSION = 3;
let memoryFactory: IDBFactory | undefined;

export function activeDatabaseName(): string {
  if (typeof window === "undefined") return "quire";
  try {
    const list = JSON.parse(window.localStorage.getItem("quire.campaigns.v1") || "[]") as { id?: string; db?: string }[];
    const active = window.localStorage.getItem("quire.campaign.v1");
    const found = Array.isArray(list) ? list.find((row) => row.id === active) : undefined;
    if (found && typeof found.db === "string" && found.db.startsWith("quire")) return found.db;
  } catch {
    // Keep the original store.
  }
  return "quire";
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Library storage failed."));
  });
}

let opening: Promise<IDBDatabase> | null = null;
let openName = "";

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Library storage is only available in the browser."));
  }
  const memory = isEphemeralCampaign();
  if (memory && !memoryFactory) { const { IDBFactory } = await import("fake-indexeddb"); memoryFactory = new IDBFactory(); }
  const factory = memory ? memoryFactory! : indexedDB;
  const name = memory ? "guest-memory" : activeDatabaseName();
  if (opening && openName === name) return opening;
  openName = name;
  opening = new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
        if (!db.objectStoreNames.contains("articles")) {
          const store = db.createObjectStore("articles", { keyPath: "id" });
          store.createIndex("bookId", "bookId", { unique: false });
        }
        if (!db.objectStoreNames.contains("purses")) db.createObjectStore("purses", { keyPath: "id" });
        if (!db.objectStoreNames.contains("holdings")) {
          const store = db.createObjectStore("holdings", { keyPath: "id" });
          store.createIndex("purseId", "purseId", { unique: false });
        }
        if (!db.objectStoreNames.contains("shops")) db.createObjectStore("shops", { keyPath: "id" });
        if (!db.objectStoreNames.contains("stock")) {
          const store = db.createObjectStore("stock", { keyPath: "id" });
          store.createIndex("shopId", "shopId", { unique: false });
        }
        if (!db.objectStoreNames.contains("ledger")) db.createObjectStore("ledger", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
        if (!db.objectStoreNames.contains("catalog")) db.createObjectStore("catalog", { keyPath: "id" });
        if (!db.objectStoreNames.contains("lexicon")) db.createObjectStore("lexicon", { keyPath: "id" });
      };
      open.onblocked = () => {
        opening = null;
        reject(new Error("Close other Lootsplit tabs, then reload."));
      };
      open.onsuccess = () => {
        const db = open.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      open.onerror = () => {
        opening = null;
        reject(open.error ?? new Error("Could not open the library."));
      };
    });
  return opening;
}

export function quireDb(): Promise<IDBDatabase> {
  return database();
}

export function closeQuireDb() {
  const pending = opening;
  opening = null;
  openName = "";
  void pending?.then((db) => db.close()).catch(() => undefined);
}

export function deleteQuireDatabase(name: string): Promise<void> {
  if (openName === name) closeQuireDb();
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("That campaign could not be removed."));
    // A delete request cannot be cancelled. Keep it pending until other connections close.
    request.onblocked = () => {};
  });
}

export function byReadingOrder(a: Pick<Article, "pageStart" | "pageEnd" | "title">, b: Pick<Article, "pageStart" | "pageEnd" | "title">) {
  return a.pageStart - b.pageStart || a.pageEnd - b.pageEnd || a.title.localeCompare(b.title);
}

export async function listBooks(): Promise<Book[]> {
  const db = await database();
  const books = await request(db.transaction("books").objectStore("books").getAll());
  return books.sort((a, b) => b.importedAt - a.importedAt);
}

export async function getBook(id: string): Promise<Book | null> {
  const db = await database();
  return (await request(db.transaction("books").objectStore("books").get(id))) ?? null;
}

export async function articlesForBook(bookId: string): Promise<Article[]> {
  const db = await database();
  const articles = await request(db.transaction("articles").objectStore("articles").index("bookId").getAll(bookId));
  return articles.sort(byReadingOrder);
}

export async function getArticle(id: string): Promise<Article | null> {
  const db = await database();
  return (await request(db.transaction("articles").objectStore("articles").get(id))) ?? null;
}

export async function articleNeighbors(article: Article): Promise<{ prev: Article | null; next: Article | null }> {
  const articles = await articlesForBook(article.bookId);
  const index = articles.findIndex((item) => item.id === article.id);
  return {
    prev: index > 0 ? (articles[index - 1] ?? null) : null,
    next: articles[index + 1] ?? null,
  };
}

export async function listFavorites(): Promise<Article[]> {
  const db = await database();
  const articles = await request(db.transaction("articles").objectStore("articles").getAll());
  return articles.filter((article) => article.favorite).sort((a, b) => a.title.localeCompare(b.title));
}

export async function randomArticleId(): Promise<string | null> {
  const db = await database();
  const keys = await request(db.transaction("articles").objectStore("articles").getAllKeys());
  if (keys.length === 0) return null;
  const key = keys[Math.floor(Math.random() * keys.length)];
  return typeof key === "string" ? key : null;
}

export async function searchArticles(query: string): Promise<Article[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const db = await database();
  const articles = await request(db.transaction("articles").objectStore("articles").getAll());
  return articles
    .map((article) => {
      const titleAt = article.title.toLowerCase().indexOf(needle);
      const bodyAt = article.text.toLowerCase().indexOf(needle);
      if (titleAt < 0 && bodyAt < 0) return null;
      const rank = titleAt === 0 ? 0 : titleAt > 0 ? 1 : 2;
      return { article, rank };
    })
    .filter((hit): hit is { article: Article; rank: number } => hit !== null)
    .sort((a, b) => a.rank - b.rank || a.article.pageStart - b.article.pageStart)
    .slice(0, 40)
    .map((hit) => hit.article);
}

export async function saveImport(book: Book, drafts: DraftArticle[]): Promise<void> {
  const articles: Article[] = drafts.map((draft) => ({
    ...draft,
    id: crypto.randomUUID(),
    bookId: book.id,
    favorite: false,
  }));
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["books", "articles"], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save this PDF."));
    tx.objectStore("books").put({ ...book, articleCount: articles.length });
    const store = tx.objectStore("articles");
    for (const article of articles) store.put(article);
  });
}

export async function renameBook(id: string, title: string): Promise<void> {
  const db = await database();
  const book = await request(db.transaction("books").objectStore("books").get(id));
  if (!book) return;
  book.title = title.trim() || book.title;
  await request(db.transaction("books", "readwrite").objectStore("books").put(book));
}

export async function setFavorite(id: string, favorite: boolean): Promise<Article | null> {
  const db = await database();
  const article = await request(db.transaction("articles").objectStore("articles").get(id));
  if (!article) return null;
  article.favorite = favorite;
  await request(db.transaction("articles", "readwrite").objectStore("articles").put(article));
  return article;
}

export async function deleteBook(id: string): Promise<void> {
  const db = await database();
  const articles = await request(db.transaction("articles").objectStore("articles").index("bookId").getAll(id));
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["books", "articles"], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not remove this PDF."));
    tx.objectStore("books").delete(id);
    const store = tx.objectStore("articles");
    for (const article of articles) store.delete(article.id);
  });
}
