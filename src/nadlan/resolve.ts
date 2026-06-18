import { config } from "../config.js";
import { log } from "../log.js";
import { findSettlementId, canonicalName, normalizeHe } from "./cbs-settlements.js";
import type { ResolvedSettlement } from "./types.js";

// api.nadlan.gov.il hosts deal-info (www. → api.). Server-side, open, GovMap-free.
const NADLAN_API_BASE = config.nadlanBaseUrl.includes("://www.")
  ? config.nadlanBaseUrl.replace("://www.", "://api.")
  : "https://api.nadlan.gov.il";

interface DealInfoSettlement {
  base_level: string;
  setl_id: string;
  setl_name: string;
}

/** Validate a settlement id nadlan-native (no GovMap, no reCAPTCHA). null on any failure. */
async function dealInfoSettlement(id: string): Promise<DealInfoSettlement | null> {
  try {
    const res = await fetch(`${NADLAN_API_BASE}/deal-info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: `${config.nadlanBaseUrl}/`,
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ base_name: "setl_id", base_id: id }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<DealInfoSettlement>;
    return j.base_level === "settlement" && j.setl_id && j.setl_name
      ? { base_level: j.base_level, setl_id: j.setl_id, setl_name: j.setl_name }
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a property to its nadlan settlement. Prefers an explicit `city` (e.g.
 * the property-card city field); falls back to scanning the free-text address.
 * Returns null when no known city matches (→ Source-2-only report) or when the
 * live deal-info name disagrees with the table (fail-safe against a bad code).
 *
 * Option B: settlement level only. Pagination/filter narrows to street/rooms/m²
 * locally — no GovMap, no search box.
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
  const info = await dealInfoSettlement(hit.id);
  if (!info) {
    log.warn({ id: hit.id }, "resolveSettlement: deal-info validation failed");
    return null;
  }
  // Fail-safe: the live name must match the table's canonical name.
  if (normalizeHe(info.setl_name) !== normalizeHe(canonicalName(hit.id) ?? "")) {
    log.warn({ id: hit.id, live: info.setl_name }, "resolveSettlement: name mismatch — rejecting");
    return null;
  }
  return {
    settlementId: info.setl_id,
    settlementName: info.setl_name,
    level: "settlement",
    matchedCity: hit.matched,
  };
}
