import { ensurePersonalProject } from "@patcher/db";
import type { DbConnection } from "@patcher/db";

export function ensurePersonalProjectBootstrap(db: DbConnection): void {
  ensurePersonalProject(db);
}
