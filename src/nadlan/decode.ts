import { gunzipSync } from "node:zlib";
import type { RawDeal } from "./types.js";

/** Decoded deal-data envelope. items live at data.items (spike-verified). */
export interface DealDataEnvelope {
  statusCode?: number;
  data?: {
    total_rows?: number;
    total_fetch?: number;
    total_page?: number;
    items?: RawDeal[];
  };
}

/**
 * Decode an api.nadlan.gov.il/deal-data response body. The proven encoding is
 * Base64 → Gzip → JSON (PH1 spike). Falls back to plain JSON. Never throws —
 * returns null on anything unrecognized.
 */
export function decodeDealData(buf: Buffer): DealDataEnvelope | null {
  const s = buf.toString("utf8");
  try {
    const b = Buffer.from(s.replace(/^"|"$/g, ""), "base64");
    return JSON.parse(gunzipSync(b).toString("utf8")) as DealDataEnvelope;
  } catch {
    /* not base64+gzip — try plain JSON */
  }
  try {
    return JSON.parse(s) as DealDataEnvelope;
  } catch {
    return null;
  }
}

export function extractItems(env: DealDataEnvelope | null): RawDeal[] {
  const items = env?.data?.items;
  return Array.isArray(items) ? items : [];
}
