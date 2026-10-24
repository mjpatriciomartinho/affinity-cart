import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Qloo } from "../qloo.ts";
import { getKey } from "../secrets.ts";
import type { ProductDNA, Snapshot } from "../types.ts";
import { catalogEntityTypes, rank, tasteProfile } from "./recs.ts";

// Gift concierge: a shopper says what the recipient loves (a band, a film, a
// show); the agent grounds those tastes in Qloo and picks from THIS shop's
// in-stock catalog only. The catalog tool can only return shop products and
// the final tool rejects anything else, so it can't recommend outside the shop.

export type GiftRequest = { tastes: string[]; budget?: number; city?: string };
export type GiftResult = {
  summary: string;
  picks: { productId: string; why: string }[];
  trace: { tool: string; label: string }[];
};

const KINDS = ["artist", "movie", "tv_show", "book", "video_game", "podcast", "brand", "person", "destination"] as const;

const SYSTEM = `You are the gift concierge of an independent shop. The shopper tells you what the gift's recipient loves. Pick 1-3 products from this shop that the recipient would genuinely love.

1. Ground each taste with find_taste (choose the right kind: a band is an artist, a film is a movie). If the top result is clearly the wrong thing, try a better query or skip it.
2. Call shop_matches with the grounded ids. It returns this shop's in-stock products ranked by how strongly people with that taste love them, per Qloo, with the reasons.
3. Choose 1-3 products, ideally from different categories so it feels curated. Respect the budget.
4. Call submit_picks once. Each "why" is one warm, specific sentence the shopper will read, tied to the recipient's tastes and the Qloo reason (e.g. "Fleet Foxes fans over-index on Fjällräven, and the Kånken is its classic"). Never invent numbers or products.`;

export async function runGiftConcierge(
  qloo: Qloo,
  snap: Snapshot,
  dna: ProductDNA[],
  req: GiftRequest,
): Promise<GiftResult> {
  const client = new Anthropic({ apiKey: await getKey("claude-servikaki.env", "ANTHROPIC_API_KEY") });
  const dnaBy = new Map(dna.map((d) => [d.productId, d]));
  const byId = new Map(snap.products.map((p) => [p.id, p]));
  const trace: GiftResult["trace"] = [];
  const offered = new Set<string>();
  let result: Omit<GiftResult, "trace"> | undefined;

  const findTaste = betaZodTool({
    name: "find_taste",
    description: "Find a taste (artist, film, show, book, game, podcast, brand, person, place) in the Qloo taste graph. Returns up to 3 candidates.",
    inputSchema: z.object({ query: z.string(), kind: z.enum(KINDS) }),
    run: async ({ query, kind }) => {
      const results = await qloo.search(query, `urn:entity:${kind}`, 3);
      trace.push({ tool: "find_taste", label: `Found “${results[0]?.name ?? query}” in Qloo` });
      return JSON.stringify(
        results.map((r) => ({ id: r.entity_id, name: r.name, about: r.properties?.short_description?.slice(0, 120) })),
      );
    },
  });

  const shopMatches = betaZodTool({
    name: "shop_matches",
    description: "Rank this shop's in-stock products by how much people with the given Qloo tastes love them. Only returns products from this shop.",
    inputSchema: z.object({ entity_ids: z.array(z.string()).min(1).max(5), max_price: z.number().optional() }),
    run: async ({ entity_ids, max_price }) => {
      const seed: ProductDNA = { productId: "gift", entity: undefined, tags: [], interests: [], note: "" };
      const profile = await tasteProfile(qloo, [seed], { location: req.city || snap.store.city, entityTypes: catalogEntityTypes(dna), entities: entity_ids });
      const candidates = snap.products.filter((p) => max_price === undefined || p.price <= max_price);
      const ranked = rank(profile, candidates, dnaBy, { ids: new Set(), categories: new Set() }, 10);
      trace.push({ tool: "shop_matches", label: `Ranked the shop for that taste: ${ranked.length} matches` });
      ranked.forEach((r) => offered.add(r.productId));
      return JSON.stringify(
        ranked.map((r) => {
          const p = byId.get(r.productId)!;
          return { id: p.id, name: p.name, category: p.categories[0], price: p.price, match: r.score, because: r.because };
        }),
      );
    },
  });

  const submit = betaZodTool({
    name: "submit_picks",
    description: "Submit the final 1-3 picks. Only ids returned by shop_matches are accepted.",
    inputSchema: z.object({
      summary: z.string().describe("One short sentence describing the recipient's taste"),
      picks: z.array(z.object({ product_id: z.string(), why: z.string() })).min(1).max(3),
    }),
    run: async ({ summary, picks }) => {
      const bad = picks.filter((p) => !offered.has(p.product_id) || (byId.get(p.product_id)?.stock ?? 1) <= 0);
      if (bad.length) return `Rejected ${bad.map((b) => b.product_id).join(", ")}: only in-stock products returned by shop_matches can be picked.`;
      result = { summary, picks: picks.map((p) => ({ productId: p.product_id, why: p.why })) };
      return "Saved.";
    },
  });

  const ask = [`The recipient loves: ${req.tastes.join("; ")}.`, req.budget ? `Budget: up to ${req.budget} ${snap.store.currency} per gift.` : ""]
    .filter(Boolean)
    .join("\n");

  await client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    max_iterations: 10,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `${SYSTEM}\n\nShop: ${snap.store.name}, ${snap.store.city}.`,
    tools: [findTaste, shopMatches, submit],
    messages: [{ role: "user", content: ask }],
  });

  if (!result) throw new Error("The concierge couldn't find a fitting gift. Try another taste.");
  trace.push({ tool: "submit_picks", label: "Picked from what's in stock" });
  return { ...result, trace };
}
