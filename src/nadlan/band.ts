import type { NadlanComparable } from "./types.js";

export interface AggregateBand {
  price_per_sqm_estimate: number; // median
  low: number; // p25
  high: number; // p75
  n: number; // sample size
  confidence: "high" | "medium" | "low";
}

const MIN_BAND_SAMPLE = 5; // below this, no band (null)

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * ₪/m² band from the room-matched settlement sample (project deals included —
 * they carry real priceSM). Median estimate + p25/p75 spread. Confidence scales
 * with sample size. Returns null when too few priced rows to be meaningful.
 */
export function computeBand(sample: NadlanComparable[]): AggregateBand | null {
  const vals = sample
    .map((c) => c.price_per_sqm)
    .filter((v): v is number => v != null && v > 0)
    .sort((a, b) => a - b);
  if (vals.length < MIN_BAND_SAMPLE) return null;

  const confidence = vals.length >= 30 ? "high" : vals.length >= 10 ? "medium" : "low";
  return {
    price_per_sqm_estimate: Math.round(percentile(vals, 0.5)),
    low: Math.round(percentile(vals, 0.25)),
    high: Math.round(percentile(vals, 0.75)),
    n: vals.length,
    confidence,
  };
}
