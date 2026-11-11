import data from "./catalog.json" with { type: "json" };
import type { IconLookup } from "./resolve";

/** The SRD record and name tables, imported only through `loadIconCatalog` (its own chunk). */
const tables: IconLookup = data;
export default tables;
