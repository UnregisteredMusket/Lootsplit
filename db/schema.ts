import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const campaignRooms = sqliteTable("campaign_rooms", {
  code: text("code").primaryKey(),
  revision: integer("revision").notNull(),
  body: text("body").notNull(),
});
