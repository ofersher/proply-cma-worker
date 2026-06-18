/**
 * Static Israeli settlement table — nadlan `setl_id` IS the CBS "סמל יישוב" code
 * (verified live: 5000=תל אביב-יפו, 4000=חיפה, 3000=ירושלים …). Curated to the
 * major urban settlements that carry the bulk of CMA volume; every code below
 * was confirmed against api.nadlan.gov.il/deal-info. Unmatched input resolves to
 * null → that report runs Source-2 (web-search) only.
 *
 * ZERO GovMap: this replaces a GovMap geocoder. Canonical `name` is nadlan's own
 * spelling; `aliases` cover common property-card variants.
 */

interface Settlement {
  id: string;
  name: string; // nadlan canonical
  aliases?: string[]; // common card spellings
}

const SETTLEMENTS: Settlement[] = [
  { id: "5000", name: "תל אביב-יפו", aliases: ["תל אביב"] },
  { id: "3000", name: "ירושלים" },
  { id: "4000", name: "חיפה" },
  { id: "70", name: "אשדוד" },
  { id: "7400", name: "נתניה" },
  { id: "9000", name: "באר שבע" },
  { id: "8300", name: "ראשון לציון" },
  { id: "7900", name: "פתח תקווה", aliases: ["פתח תקוה"] },
  { id: "6100", name: "בני ברק" },
  { id: "6600", name: "חולון" },
  { id: "8600", name: "רמת גן" },
  { id: "7100", name: "אשקלון" },
  { id: "8400", name: "רחובות" },
  { id: "6200", name: "בת ים" },
  { id: "6900", name: "כפר סבא" },
  { id: "6400", name: "הרצלייה", aliases: ["הרצליה"] },
  { id: "6500", name: "חדרה" },
  { id: "1200", name: "מודיעין-מכבים-רעות", aliases: ["מודיעין", "מכבים רעות"] },
  { id: "7300", name: "נצרת" },
  { id: "8500", name: "רמלה" },
  { id: "8700", name: "רעננה" },
  { id: "6300", name: "גבעתיים" },
  { id: "9700", name: "הוד השרון" },
  { id: "2630", name: "קריית גת", aliases: ["קרית גת"] },
  { id: "9100", name: "נהרייה", aliases: ["נהריה"] },
  { id: "7000", name: "לוד" },
  { id: "7600", name: "עכו" },
  { id: "2600", name: "אילת" },
  { id: "2650", name: "רמת השרון" },
  { id: "2660", name: "יבנה" },
  { id: "6800", name: "קריית אתא", aliases: ["קרית אתא"] },
  { id: "2200", name: "דימונה" },
  { id: "6700", name: "טבריה" },
  { id: "3780", name: "ביתר עילית" },
  { id: "3797", name: "מודיעין עילית" },
  { id: "7200", name: "נס ציונה" },
  { id: "2400", name: "אור יהודה" },
  { id: "8000", name: "צפת" },
  { id: "8200", name: "קריית מוצקין", aliases: ["קרית מוצקין"] },
  { id: "9500", name: "קריית ביאליק", aliases: ["קרית ביאליק"] },
  { id: "9600", name: "קריית ים", aliases: ["קרית ים"] },
  { id: "2620", name: "קריית אונו", aliases: ["קרית אונו"] },
  { id: "9400", name: "יהוד-מונוסון", aliases: ["יהוד"] },
  { id: "2640", name: "ראש העין" },
  { id: "3570", name: "אריאל" },
  { id: "7700", name: "עפולה" },
  { id: "1139", name: "כרמיאל" },
  { id: "3616", name: "מעלה אדומים" },
  { id: "1031", name: "שדרות" },
  { id: "246", name: "נתיבות" },
  { id: "31", name: "אופקים" },
  { id: "1034", name: "קריית מלאכי", aliases: ["קרית מלאכי"] },
  { id: "1063", name: "מעלות-תרשיחא", aliases: ["מעלות"] },
];

/** Strip nikud/cantillation + quotes, hyphens→space, collapse whitespace. */
export function normalizeHe(s: string): string {
  return String(s)
    .replace(/[֑-ׇ]/g, "")
    .replace(/["'`׳״]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// normalized (name + aliases) index, longest-first so "מודיעין עילית" wins over
// the "מודיעין" alias and "תל אביב יפו" over "תל אביב".
const INDEX: Array<{ id: string; norm: string }> = [];
for (const s of SETTLEMENTS) {
  for (const nm of [s.name, ...(s.aliases ?? [])]) INDEX.push({ id: s.id, norm: normalizeHe(nm) });
}
INDEX.sort((a, b) => b.norm.length - a.norm.length);

const NAME_BY_ID = new Map(SETTLEMENTS.map((s) => [s.id, s.name]));
export function canonicalName(id: string): string | undefined {
  return NAME_BY_ID.get(id);
}

/**
 * Find a settlement id by scanning the text for any known name/alias (longest
 * match wins). Substring-based — pass an explicit city when available to avoid
 * "street named after a city" ambiguity. Returns null if nothing matches.
 */
export function findSettlementId(text: string): { id: string; matched: string } | null {
  const t = normalizeHe(text);
  if (!t) return null;
  for (const e of INDEX) if (t.includes(e.norm)) return { id: e.id, matched: e.norm };
  return null;
}
