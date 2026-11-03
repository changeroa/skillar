// SPDX-License-Identifier: AGPL-3.0-only
import { hashContent } from "../../../shared/activity-content.ts";

/** Primary credential/handle hashes use bare hex, not release-file digest URIs. */
export function sha256(value: string): Promise<string> {
  return hashContent(new TextEncoder().encode(value));
}
