import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getKey } from "../secrets.ts";
import type { GhostItem, ProductDNA, Snapshot, Tribe } from "../types.ts";

// Step 3 — Ghost catalog: what the store's own buyers love, per Qloo, that the
// store doesn't sell. Qloo supplies the candidates (brands each tribe
// over-indexes on, in its city); the scout agent names the tribes, groups the
// candidates into sourcing opportunities and explains each one with evidence.

export type GhostCandidate = { brand: string; affinity: number; tribeId: string; categories: string[] };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function ghostCandidates(snap: Snapshot, dna: ProductDNA[], tribes: Tribe[]): GhostCandidate[] {
  const carried = new Set([
    ...snap.products.map((p) => norm(p.brand)),
    ...dna.flatMap((d) => (d.entity ? [norm(d.entity.name)] : [])),
  ]);
  const isCarried = (name: string) => [...carried].some((c) => c && (norm(name).startsWith(c) || c.startsWith(norm(name))));
  return tribes.flatMap((t) =>
    (t.culture?.brands ?? [])
      .filter((b) => !isCarried(b.name))
      .slice(0, 15)
      .map((b) => ({ brand: b.name, affinity: b.affinity, tribeId: t.id, categories: b.tags ?? [] })),
  );
}

const Output = z.object({
  tribes: z.array(
    z.object({
      id: z.string(),
      name: z.string().describe("2-4 words a merchant would use, e.g. 'Weekend trail walkers'"),
      description: z.string().describe("One sentence: who they are and what they buy here"),
    }),
  ),
  ghost: z.array(
    z.object({
      title: z.string().describe("The opportunity, e.g. 'Trail running accessories' or 'Barbour'"),
      kind: z.enum(["brand", "category"]),
      examples: z.array(z.string()).describe("Brands from the candidates that illustrate it"),
      tribe_ids: z.array(z.string()),
      evidence: z.array(z.string()).describe("Concrete Qloo signals copied from the input, e.g. 'Buff 0.98 (trail tribe, Madrid)'"),
      why: z.string().describe("One or two sentences for the merchant: why this fits their buyers"),
    }),
  ),
});

export async function scoutGhostCatalog(
  snap: Snapshot,
  tribes: Tribe[],
  candidates: GhostCandidate[],
  productName: (id: string) => string,
): Promise<{ tribes: { id: string; name: string; description: string }[]; ghost: GhostItem[] }> {
  const client = new Anthropic({ apiKey: await getKey("claude-servikaki.env", "ANTHROPIC_API_KEY") });
  const brief = tribes.map((t) => ({
    id: t.id,
    customers: t.customers,
    revenue_share: t.share,
    cities: t.cities.slice(0, 3),
    tastes: t.topTags.map((x) => x.tag.name),
    loves_in_store: t.topProducts.slice(0, 5).map(productName),
    also_loves_artists: t.culture?.artists.slice(0, 5).map((a) => a.name),
    also_loves_movies: t.culture?.movies.slice(0, 5).map((a) => a.name),
    brands_not_stocked: candidates.filter((c) => c.tribeId === t.id).map((c) => `${c.brand} ${c.affinity} [${c.categories.join(", ")}]`),
  }));
  const catalog = [...new Set(snap.products.flatMap((p) => p.categories))].join(", ");

  const res = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(Output) },
    system: `You advise an independent shop on what to stock next. You get its customer tribes (found from real orders), what each tribe buys here, and the brands the Qloo taste graph says each tribe over-indexes on but the shop does not sell (with affinity 0-1).

Name each tribe. Then propose 5-8 ghost-catalog opportunities: brands or categories the shop should consider stocking. Prefer things a small lifestyle shop could actually source and that fit its categories or extend them sensibly; skip services, airlines, banks, supermarkets and anything implausible for a shop. Group related brands into a category when that reads better. Evidence must quote signals from the input, never invent numbers.`,
    messages: [{ role: "user", content: `Shop: ${snap.store.name}, ${snap.store.city}. Sells: ${catalog}.\n\nTribes:\n${JSON.stringify(brief, null, 1)}` }],
  });
  const out = res.parsed_output;
  if (!out) throw new Error("Scout returned no parsable output");

  const shareOf = new Map(tribes.map((t) => [t.id, t.share]));
  return {
    tribes: out.tribes,
    ghost: out.ghost.map((g) => ({
      title: g.title,
      kind: g.kind,
      examples: g.examples,
      tribeIds: g.tribe_ids,
      audienceShare: Math.round(g.tribe_ids.reduce((s, id) => s + (shareOf.get(id) ?? 0), 0) * 1000) / 1000,
      evidence: g.evidence,
      why: g.why,
    })),
  };
}
