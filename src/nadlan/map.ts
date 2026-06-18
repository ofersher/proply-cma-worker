import type { RawDeal, NadlanComparable } from "./types.js";

// --- Hebrew floor ordinals 1–40 (built programmatically; longest key first) ---
const ORD_1_10 = [
  "ראשונה", "שנייה", "שלישית", "רביעית", "חמישית",
  "שישית", "שביעית", "שמינית", "תשיעית", "עשירית",
];
const CARD_FEM = ["", "אחת", "שתים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];
const TENS_WORD: Record<number, string> = { 20: "עשרים", 30: "שלושים", 40: "ארבעים" };

function buildFloorOrdinals(): Array<[string, number]> {
  const m = new Map<string, number>();
  ORD_1_10.forEach((w, i) => m.set(w, i + 1));
  m.set("שניה", 2); // common alt spelling
  for (let n = 11; n <= 19; n++) m.set(`${CARD_FEM[n - 10]} עשרה`, n);
  m.set("שתיים עשרה", 12);
  for (const [ten, word] of Object.entries(TENS_WORD)) {
    const t = Number(ten);
    m.set(word, t);
    for (let u = 1; u <= 9; u++) m.set(`${word} ו${CARD_FEM[u]}`, t + u);
  }
  // longest key first so "עשרים ותשע" (29) wins over "עשרים" (20)
  return [...m.entries()].sort((a, b) => b[0].length - a[0].length);
}
const FLOOR_ORDINALS = buildFloorOrdinals();

/** nadlan floor text → number. Best-effort; null when unparseable. */
export function parseFloor(raw: unknown): number | null {
  if (raw == null) return null;
  // strip RTL/LTR directional marks the site wraps digits in (e.g. "קומה ‎3‏").
  const s = String(raw).replace(/[‎‏‪-‮]/g, "").trim();
  if (!s) return null;
  if (s.includes("קרקע")) return 0;
  if (s.includes("מרתף")) return -1;
  const digit = s.match(/-?\d+/);
  if (digit) {
    const n = Number(digit[0]);
    if (Number.isFinite(n)) return n;
  }
  for (const [word, n] of FLOOR_ORDINALS) if (s.includes(word)) return n;
  return null;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDate(v: unknown): string | null {
  if (typeof v === "string" && ISO_DATE.test(v)) return v;
  const d = v ? new Date(String(v)) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/**
 * Map a raw nadlan deal → NadlanComparable. Drops rows missing the
 * anti-fabrication essentials (ISO date / price). Address-less project rows
 * (address "0") are kept with a meaningful label + is_project flag.
 */
export function toComparable(r: RawDeal, sourceUrl: string): NadlanComparable | null {
  const deal_date = normalizeDate(r.dealDate);
  const price_ils = numOrNull(r.dealAmount);
  if (!deal_date || price_ils === null) return null;

  const rawAddr = typeof r.address === "string" ? r.address.trim() : "";
  const [gush, parcel] = String(r.parcelNum ?? "").split("-");
  const neighborhood =
    typeof r.neighborhoodName === "string" ? r.neighborhoodName.trim() || null : null;

  // ~55% of high-volume-city deals are project rows with address "0". Keep them
  // (real parcel/rooms/sqm/price), but give a meaningful label + flag is_project.
  const is_project = !rawAddr || rawAddr === "0";
  const address = is_project
    ? neighborhood
      ? `${neighborhood} (פרויקט)`
      : `גוש ${gush ?? "?"}/${parcel ?? "?"}`
    : rawAddr;

  return {
    address,
    deal_date,
    price_ils,
    sqm: numOrNull(r.assetArea),
    rooms: numOrNull(r.roomNum),
    floor: parseFloor(r.floor),
    year_built: numOrNull(r.yearBuilt),
    price_per_sqm: numOrNull(r.priceSM),
    neighborhood,
    gush: gush || null,
    parcel: parcel || null,
    parcel_full: typeof r.parcelNum === "string" ? r.parcelNum : null,
    is_project,
    source_url: sourceUrl,
    source_tag: "nadlan_gov",
  };
}
