/** Raw nadlan deal row (subset of the fields seen in the decoded deal-data
 *  payload; index signature keeps the rest accessible without over-typing). */
export interface RawDeal {
  assetId?: number;
  addressId?: number;
  neighborhoodName?: string;
  address?: string;
  dealDate?: string;
  dealAmount?: number;
  parcelNum?: string; // "gush-helka-tat", e.g. "6146-231-7"
  dealNature?: string;
  roomNum?: number;
  floor?: string | number; // Hebrew ordinal ("רביעית") or "קומה 3"
  assetArea?: number; // m²
  yearBuilt?: number;
  priceSM?: number; // ₪/m²
  [k: string]: unknown;
}

/**
 * Source-1 (nadlan_gov) comparable — the worker's output shape. Richer than the
 * in-app Comparable: it carries gush/parcel/price_per_sqm/neighborhood that the
 * Vercel merge uses for dedup + near-subject matching before narrowing to the
 * in-app Comparable. source_url is MANDATORY (anti-fabrication anchor) — rows
 * without the essentials are dropped.
 */
export interface NadlanComparable {
  address: string;
  deal_date: string; // ISO YYYY-MM-DD
  price_ils: number;
  sqm: number | null;
  rooms: number | null;
  floor: number | null;
  year_built: number | null;
  price_per_sqm: number | null;
  neighborhood: string | null;
  gush: string | null;
  parcel: string | null;
  parcel_full: string | null;
  /** TRUE for new-construction/project deals (nadlan address "0", addressId 0):
   *  real parcel/rooms/sqm/price + neighborhood but NO street. ~55% of deals in
   *  high-volume cities. Kept for the band + neighborhood matching; excluded
   *  from street matching. */
  is_project: boolean;
  source_url: string;
  source_tag: "nadlan_gov";
}

/** Settlement resolution output (Option B: city level). */
export interface ResolvedSettlement {
  settlementId: string;
  settlementName: string; // nadlan canonical (from deal-info)
  level: "settlement";
  matchedCity: string; // what was matched in the input
}
