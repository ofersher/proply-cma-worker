import { log } from "../log.js";
import { findSettlementId, canonicalName } from "./cbs-settlements.js";
import type { ResolvedSettlement } from "./types.js";

/**
 * Resolve a property to its nadlan settlement from the curated CBS table.
 * Prefers an explicit `city` (the property-card city field); falls back to
 * scanning the free-text address. Returns null only when no known city matches
 * (→ Source-2-only report).
 *
 * We do NOT validate via api.nadlan.gov.il/deal-info: it now returns "Forbidden"
 * for non-browser (bare Node fetch) requests, and gating the pull on it aborted
 * before the headed browser — the part that loads the real page and lets the
 * SITE mint its own token — ever ran. The CBS table IS the source of truth
 * (every setl_id was verified live in CP3), and the browser pull itself confirms
 * the id by returning that settlement's deals. No GovMap, no forging.
 *
 * Option B: settlement level only. Pagination/filter narrows to street/rooms/m²
 * locally.
 */
export async function resolveSettlement(input: {
  address?: string;
  city?: string;
}): Promise<ResolvedSettlement | null> {
  const hay = (input.city || input.address || "").trim();
  const hit = findSettlementId(hay);
  if (!hit) {
    log.info({ hay }, "resolveSettlement: no city match in CBS table");
    return null;
  }
  return {
    settlementId: hit.id,
    settlementName: canonicalName(hit.id) ?? hit.matched,
    level: "settlement",
    matchedCity: hit.matched,
  };
}
