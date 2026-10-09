import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
// Credentials survive plugin removal; deletion requires its own human approval.
export const protectedCredentials = sqliteTable(
  "protected_credentials",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    sourceHash: text("source_hash").notNull(),
    origin: text("origin").notNull(),
    accountId: text("account_id").notNull(),
    version: integer("version").notNull(),
    record: text("record", { mode: "json" }).$type<unknown>().notNull(),
  },
  (table) => [
    uniqueIndex("protected_credentials_account").on(
      table.owner,
      table.sourceHash,
      table.origin,
      table.accountId,
    ),
  ],
);
