import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Qloo } from "../qloo.ts";
import { getKey } from "../secrets.ts";
import type { ProductDNA, QlooRef, SnapshotProduct } from "../types.ts";

// Step 1 — Catalog DNA. Qloo knows culture, not SKUs: it has no entity for
// "leather hiking boots", but it does know urn:tag:keyword:qloo:hiking, the
// brand Fjällräven, the album "For Emma, Forever Ago" and the game "Alan Wake 2".
// The profiler agent translates each product into those, verifying every id
// against Qloo before saving it.

// Types /v2/insights can return, so every saved entity can be matched later.
// (No "album": a record is represented by its artist.)
const ENTITY_TYPES = ["brand", "book", "artist", "video_game", "movie", "tv_show", "podcast", "person"] as const;

const SYSTEM = `You translate an online shop's products into the Qloo taste graph so the shop can recommend across categories.

For each product:
1. If the product itself is a cultural work, find it with qloo_search_entity: a book as a book, a video game as a video_game, a film as a movie. A record (vinyl, CD) is represented by its artist. Otherwise look up its brand as a brand. Use the entity only if it is clearly the same thing; generic or house-brand items have no entity.
2. Find 3-6 Qloo tags that describe who buys it and why: the activity, aesthetic or genre (e.g. hiking boots -> hiking, trekking, nature; a survival-horror game -> horror, video games; a pour-over coffeemaker -> coffee, specialty coffee). Use qloo_find_tags; prefer keyword, genre and theme tags over place amenities. Only use ids the tools returned.
3. Call save_product_dna once per product with the entity (if any), the tags, 2-4 short plain-English interests for the merchant, and a one-line note on how you decided.

Be economical: one or two searches per idea, then decide. Process every product you are given.`;

export async function profileCatalog(
  qloo: Qloo,
  products: SnapshotProduct[],
  opts: { batchSize?: number; concurrency?: number; onSaved?: (dna: ProductDNA) => void } = {},
): Promise<ProductDNA[]> {
  const client = new Anthropic({ apiKey: await getKey("claude-servikaki.env", "ANTHROPIC_API_KEY") });
  const batches: SnapshotProduct[][] = [];
  const size = opts.batchSize ?? 6;
  for (let i = 0; i < products.length; i += size) batches.push(products.slice(i, i + size));

  const out: ProductDNA[] = [];
  const queue = [...batches];
  const worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      for (const dna of await profileBatch(client, qloo, b)) {
        out.push(dna);
        opts.onSaved?.(dna);
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 3 }, worker));
  return out;
}

async function profileBatch(client: Anthropic, qloo: Qloo, products: SnapshotProduct[]): Promise<ProductDNA[]> {
  const seen = new Map<string, QlooRef>(); // ids the tools actually returned
  const saved = new Map<string, ProductDNA>();
  const ids = new Set(products.map((p) => p.id));

  const searchEntity = betaZodTool({
    name: "qloo_search_entity",
    description: "Search the Qloo taste graph for a named entity (brand, book, album, artist, video game, film...).",
    inputSchema: z.object({ query: z.string(), type: z.enum(ENTITY_TYPES) }),
    run: async ({ query, type }) => {
      const results = await qloo.search(query, `urn:entity:${type}`, 4);
      return JSON.stringify(
        results.map((r) => {
          const ref = { id: r.entity_id, name: r.name, type: `urn:entity:${type}` };
          seen.set(ref.id, ref);
          return { ...ref, about: r.properties?.short_description?.slice(0, 140) };
        }),
      );
    },
  });

  const findTags = betaZodTool({
    name: "qloo_find_tags",
    description: "Find Qloo tags matching a word or short phrase (e.g. 'hiking', 'horror', 'specialty coffee').",
    inputSchema: z.object({ query: z.string() }),
    run: async ({ query }) => {
      const tags = await qloo.tags(query, undefined, 12);
      return JSON.stringify(
        tags.map((t) => {
          const ref = { id: t.id, name: t.name, type: t.type };
          seen.set(ref.id, ref);
          return ref;
        }),
      );
    },
  });

  const save = betaZodTool({
    name: "save_product_dna",
    description: "Save the taste-graph translation of one product.",
    inputSchema: z.object({
      product_id: z.string(),
      entity_id: z.string().optional().describe("Qloo entity id for the product or its brand, if any"),
      tag_ids: z.array(z.string()).min(1).max(6),
      interests: z.array(z.string()).min(1).max(4),
      note: z.string(),
    }),
    run: async ({ product_id, entity_id, tag_ids, interests, note }) => {
      if (!ids.has(product_id)) return `Unknown product_id ${product_id}.`;
      const unknown = [entity_id, ...tag_ids].filter((id): id is string => !!id && !seen.has(id));
      if (unknown.length) return `These ids did not come from a Qloo search: ${unknown.join(", ")}. Search first.`;
      saved.set(product_id, {
        productId: product_id,
        entity: entity_id ? seen.get(entity_id) : undefined,
        tags: tag_ids.map((id) => seen.get(id)!),
        interests,
        note,
      });
      const left = products.filter((p) => !saved.has(p.id)).length;
      return left ? `Saved. ${left} product(s) left.` : "Saved. All products done.";
    },
  });

  const list = products
    .map((p) => `- id ${p.id}: "${p.name}" by ${p.brand || "no brand"} [${p.categories.join(", ")}] ${p.description}`)
    .join("\n");

  await client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    max_iterations: 40,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    tools: [searchEntity, findTags, save],
    messages: [{ role: "user", content: `Products:\n${list}` }],
  });

  return [...saved.values()];
}
