// SPDX-License-Identifier: AGPL-3.0-only
import type { PrivateSkillPrincipal } from "../../../shared/private-skills.ts";
import { PrivateSkillError } from "./contracts.ts";

export type PrivateRate = "search" | "read" | "write";
const limits = { search: 120, read: 600, write: 30 } as const;

/** Fixed minute admission is atomic for both account and credential; no alarms. */
export function admitPrivateSkill(
  storage: DurableObjectStorage, principal: PrivateSkillPrincipal, category: PrivateRate,
): void {
  const minute = Math.floor(Date.now() / 60_000);
  const credential = principal.kind === "browser" ? `sid:${principal.sessionId}` : `token:${principal.tokenHash}`;
  storage.transactionSync(() => {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS private_skill_limits (
      category TEXT NOT NULL, credential TEXT NOT NULL, minute INTEGER NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY(category,credential,minute))`);
    storage.sql.exec("DELETE FROM private_skill_limits WHERE minute<?", minute);
    const keys = ["account", credential];
    for (const key of keys) {
      const row = storage.sql.exec<{ count: number }>(`SELECT count FROM private_skill_limits
        WHERE category=? AND credential=? AND minute=?`, category, key, minute).toArray()[0];
      if ((row?.count ?? 0) >= limits[category]) throw new PrivateSkillError(429, "rate_limited");
    }
    for (const key of keys) {
      storage.sql.exec(`INSERT INTO private_skill_limits VALUES(?,?,?,1)
        ON CONFLICT(category,credential,minute) DO UPDATE SET count=count+1`, category, key, minute);
    }
  });
}
