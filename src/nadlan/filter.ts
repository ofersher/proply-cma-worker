import { normalizeHe } from "./cbs-settlements.js";
import type { NadlanComparable } from "./types.js";

export interface SubjectFilter {
  street?: string | null;
  rooms?: number | null;
  sqm?: number | null;
  neighborhood?: string | null;
}
export interface NearSubjectResult {
  comparables: NadlanComparable[]; // near-subject (room+street+sqm)
  settlement_sample: NadlanComparable[]; // room-matched buffer → aggregate band
  rooms_matched: number;
}

const ROOM_TOLERANCE = 1; // rooms within ±1 of the subject (tunable)
const SQM_BAND = 0.25; // ±25% of subject m²
const MIN_COMPS = 3; // below this, widen to the neighbourhood

/** Street part of an address (drop the house number). "" for project rows. */
export function streetOf(address: string): string {
  return normalizeHe(String(address).replace(/\s*\d+.*$/, ""));
}

function roomMatch(r: NadlanComparable, rooms?: number | null): boolean {
  if (rooms == null) return true;
  return r.rooms != null && Math.abs(r.rooms - rooms) <= ROOM_TOLERANCE;
}
function sqmMatch(r: NadlanComparable, sqm?: number | null): boolean {
  if (sqm == null) return true;
  return r.sqm != null && r.sqm >= sqm * (1 - SQM_BAND) && r.sqm <= sqm * (1 + SQM_BAND);
}
// both sides must be real streets (len >= 2); project rows never street-match.
// Guards the empty-street over-match bug (subjStreet.includes("") === true).
function streetMatch(r: NadlanComparable, street?: string | null): boolean {
  if (!street || r.is_project) return false;
  const a = streetOf(r.address);
  const s = normalizeHe(street);
  return s.length >= 2 && a.length >= 2 && (a.includes(s) || s.includes(a));
}
function neighMatch(r: NadlanComparable, neigh?: string | null): boolean {
  if (!neigh || !r.neighborhood) return false;
  return normalizeHe(r.neighborhood).includes(normalizeHe(neigh));
}

export function filterNearSubject(
  rows: NadlanComparable[],
  subject: SubjectFilter
): NearSubjectResult {
  // room-matched buffer drives the band (project deals included — real ₪/m²).
  const roomMatched = rows.filter((r) => roomMatch(r, subject.rooms));

  // primary: same street ∩ sqm band; if no street given, fall back to neighbourhood.
  const base = subject.street
    ? roomMatched.filter((r) => streetMatch(r, subject.street))
    : subject.neighborhood
      ? roomMatched.filter((r) => neighMatch(r, subject.neighborhood))
      : roomMatched;
  const comparables = base.filter((r) => sqmMatch(r, subject.sqm));

  // too few same-street comps → widen to the neighbourhood (project rows re-enter here).
  if (comparables.length < MIN_COMPS && subject.street && subject.neighborhood) {
    const seen = new Set(comparables.map((c) => `${c.parcel_full}|${c.deal_date}|${c.price_ils}`));
    for (const r of roomMatched) {
      if (neighMatch(r, subject.neighborhood) && sqmMatch(r, subject.sqm)) {
        const k = `${r.parcel_full}|${r.deal_date}|${r.price_ils}`;
        if (!seen.has(k)) {
          seen.add(k);
          comparables.push(r);
        }
      }
    }
  }

  return { comparables, settlement_sample: roomMatched, rooms_matched: roomMatched.length };
}
