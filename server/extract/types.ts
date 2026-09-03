/** Internal, pre-normalization shapes shared by the extraction rungs. Rungs fill what they can; normalize() completes the Product. */
import type { CartMode, ExtractResult, ExtractSource } from "../../shared/types.js";

export interface ParsedVariant {
  id?: string;
  title?: string;
  options: Record<string, string>;
  price?: number;
  currency?: string;
  compareAtPrice?: number;
  available: boolean | null;
  sku?: string;
  imageUrl?: string;
  url?: string;
}

export interface ParsedProduct {
  id?: string;
  title: string;
  brand?: string;
  /** plain text or html; normalize() strips tags */
  description?: string;
  images: string[];
  /** explicit option order from the platform; derived from variants when absent */
  options?: { name: string; values: string[] }[];
  variants: ParsedVariant[];
  specs?: Record<string, string>;
  rating?: { value: number; count?: number };
  canonicalUrl?: string;
  /** store-level currency when variants lack one */
  currency?: string;
  platform?: "shopify";
  cart?: CartMode;
  warnings: string[];
}

export type RungName = "shopify" | "jsonld" | "og" | "headless" | "fetch";

export interface Rung {
  name: RungName;
  ok: boolean;
  ms: number;
  note: string;
}

export type ExtractDebugResult = ExtractResult & { rungs: Rung[] };

export interface RungOutcome {
  parsed: ParsedProduct | null;
  source: ExtractSource;
  note: string;
}
