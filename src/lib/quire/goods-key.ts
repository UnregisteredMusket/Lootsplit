import { z } from "zod";

/** Stable units shared by property materials and exchange commodities. */
export const goodsKey = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
