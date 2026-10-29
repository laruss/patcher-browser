import { and, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { pluginSiteGrants } from "../schema.js";

export function listPluginSiteGrants(db: DbConnection, pluginId: string) {
  return db
    .select()
    .from(pluginSiteGrants)
    .where(eq(pluginSiteGrants.pluginId, pluginId))
    .all();
}
export function putPluginSiteGrant(
  db: DbConnection,
  pluginId: string,
  origin: string,
  fingerprint: string,
) {
  db.insert(pluginSiteGrants)
    .values({ pluginId, origin, fingerprint, grantedAt: Date.now() })
    .onConflictDoUpdate({
      target: [pluginSiteGrants.pluginId, pluginSiteGrants.origin],
      set: { fingerprint, grantedAt: Date.now() },
    })
    .run();
}
export function deletePluginSiteGrant(
  db: DbConnection,
  pluginId: string,
  origin?: string,
) {
  db.delete(pluginSiteGrants)
    .where(
      origin === undefined
        ? eq(pluginSiteGrants.pluginId, pluginId)
        : and(
            eq(pluginSiteGrants.pluginId, pluginId),
            eq(pluginSiteGrants.origin, origin),
          ),
    )
    .run();
}
