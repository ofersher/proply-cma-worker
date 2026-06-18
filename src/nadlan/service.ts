import { resolveSettlement } from "./resolve.js";
import { fetchComparables } from "./fetch.js";
import { computeBand } from "./band.js";
import type { SubjectFilter } from "./filter.js";

export interface ComparablesInput {
  address?: string;
  city?: string;
  gush_parcel?: { gush: string; parcel: string }; // reserved (Option B resolves by city)
  filters?: {
    rooms?: number;
    sqm?: number;
    street?: string;
    neighborhood?: string;
    monthsBack?: number;
  };
}

type Validated =
  | { ok: true; value: ComparablesInput }
  | { ok: false; error: string };

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN; // NaN signals "present but invalid"
}

/** Strict-ish validation. Requires address OR city (needed to resolve a settlement). */
export function validateInput(body: unknown): Validated {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (b.address != null && typeof b.address !== "string") return { ok: false, error: "address must be a string" };
  if (b.city != null && typeof b.city !== "string") return { ok: false, error: "city must be a string" };
  if (!b.address && !b.city) return { ok: false, error: "address or city is required" };
  if (b.filters != null && typeof b.filters !== "object") return { ok: false, error: "filters must be an object" };

  const f = (b.filters ?? {}) as Record<string, unknown>;
  const rooms = num(f.rooms);
  const sqm = num(f.sqm);
  const monthsBack = num(f.monthsBack);
  if (Number.isNaN(rooms)) return { ok: false, error: "filters.rooms must be a number" };
  if (Number.isNaN(sqm)) return { ok: false, error: "filters.sqm must be a number" };
  if (Number.isNaN(monthsBack)) return { ok: false, error: "filters.monthsBack must be a number" };
  if (f.street != null && typeof f.street !== "string") return { ok: false, error: "filters.street must be a string" };
  if (f.neighborhood != null && typeof f.neighborhood !== "string")
    return { ok: false, error: "filters.neighborhood must be a string" };

  return {
    ok: true,
    value: {
      address: b.address as string | undefined,
      city: b.city as string | undefined,
      filters: {
        rooms,
        sqm,
        monthsBack,
        street: f.street as string | undefined,
        neighborhood: f.neighborhood as string | undefined,
      },
    },
  };
}

/** Resolve → fetch (serialized via the queue) → band. Never throws on the
 *  no-city path; that returns an empty 200 so Vercel runs Source-2 only. */
export async function getComparables(input: ComparablesInput) {
  const resolved = await resolveSettlement({ address: input.address, city: input.city });
  if (!resolved) {
    return { comparables: [], settlement_sample: [], aggregate_band: null, meta: { resolved: false, reason: "no_city_match" } };
  }

  const subject: SubjectFilter = {
    street: input.filters?.street ?? null,
    rooms: input.filters?.rooms ?? null,
    sqm: input.filters?.sqm ?? null,
    neighborhood: input.filters?.neighborhood ?? null,
  };

  const result = await fetchComparables(resolved, subject, input.filters?.monthsBack);
  return {
    comparables: result.comparables,
    settlement_sample: result.settlement_sample,
    aggregate_band: computeBand(result.settlement_sample),
    meta: { ...result.meta, resolved: true },
  };
}
