import type { ToolName } from "./types";

/** Single source of truth for tool metadata. The page registers from this; docs and tests read from this. */
export interface ToolDef {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; consequentialHint?: boolean; destructiveHint?: boolean };
}

export function toolDefs(brand: string, title: string): ToolDef[] {
  const who = brand ? `${brand} ${title}` : title;
  return [
    {
      name: "get_product",
      description: `Get the normalized product record for the page: title, brand, price, description, images, options, specs, availability and canonical URL for "${who}".`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "list_variants",
      description: `List every purchasable variant of "${who}" with variant_id, option values (size, color…), price and availability. Call this before select_variant or add_to_cart.`,
      inputSchema: {
        type: "object",
        properties: {
          available_only: { type: "boolean", description: "Only return variants currently in stock. Default false." },
          max_price: { type: "number", description: "Only return variants at or below this price (in the product currency)." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "select_variant",
      description: `Select a variant on screen so the human sees it. Pass variant_id from list_variants, or option values (e.g. {"Size":"Queen"}). Returns the selected variant.`,
      inputSchema: {
        type: "object",
        properties: {
          variant_id: { type: "string", description: "Variant id from list_variants." },
          options: { type: "object", description: "Option name to value, e.g. {\"Size\":\"Queen\",\"Color\":\"White\"}.", additionalProperties: { type: "string" } },
        },
        additionalProperties: false,
      },
      annotations: {},
    },
    {
      name: "check_availability",
      description: `Check whether a variant of "${who}" is in stock right now. Uses the store's live product feed when available; otherwise reports unknown honestly.`,
      inputSchema: { type: "object", properties: { variant_id: { type: "string" } }, required: ["variant_id"], additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "ask_about_product",
      description: `Ask a question about "${who}" (materials, dimensions, care, fit, what is included). Answers only from the product's own page data and says so when the page does not say.`,
      inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "add_to_cart",
      description: `Add a variant of "${who}" to the cart. Returns a checkout URL the human can open. This is a purchase-path action: the merchant may require the human to confirm on screen.`,
      inputSchema: {
        type: "object",
        properties: { variant_id: { type: "string" }, quantity: { type: "integer", minimum: 1, maximum: 10, default: 1 } },
        required: ["variant_id"],
        additionalProperties: false,
      },
      annotations: { consequentialHint: true },
    },
    {
      name: "compare_with",
      description: `Compare "${who}" with another product page. Pass the other page's URL; returns both products side by side (price, options, availability, key specs) and opens the comparison on screen.`,
      inputSchema: { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"], additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "get_session_state",
      description: `See what the human has done on this page: selected variant, pinned variants, cart contents, and which tools the merchant currently allows. Call this before acting on the human's behalf.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
  ];
}
