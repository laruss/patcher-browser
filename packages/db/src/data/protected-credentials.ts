import { and, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { protectedCredentials as table } from "../schema-protected-credentials.js";
type Row = typeof table.$inferInsert;
export const listProtectedCredentials = (
  db: DbConnection,
  owner: string,
  sourceHash: string,
  origin: string,
) =>
  db
    .select()
    .from(table)
    .where(
      and(
        eq(table.owner, owner),
        eq(table.sourceHash, sourceHash),
        eq(table.origin, origin),
      ),
    )
    .all();
export const findProtectedCredential = (db: DbConnection, id: string) =>
  db.select().from(table).where(eq(table.id, id)).get();
export function insertProtectedCredential(db: DbConnection, row: Row) {
  db.insert(table).values(row).run();
}
export function replaceProtectedCredential(
  db: DbConnection,
  row: Row,
  version: number,
) {
  return (
    db
      .update(table)
      .set(row)
      .where(and(eq(table.id, row.id), eq(table.version, version)))
      .run().changes === 1
  );
}
export function deleteProtectedCredential(
  db: DbConnection,
  id: string,
  version: number,
) {
  return (
    db
      .delete(table)
      .where(and(eq(table.id, id), eq(table.version, version)))
      .run().changes === 1
  );
}

export const firstProtectedCredential = (db: DbConnection) =>
  db.select().from(table).limit(1).get();
