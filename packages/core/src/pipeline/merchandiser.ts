import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getKey } from "../secrets.ts";
import type { Kit, ProductDNA, SnapshotProduct } from "../types.ts";

// Names each kit and writes the one-line pitch shown on the product page.

const Output = z.object({
  kits: z.array(z.object({ id: z.string(), name: z.string(), pitch: z.string() })),
});

export async function nameKits(
  kits: Omit<Kit, "name" | "pitch">[],
  products: Map<string, SnapshotProduct>,
  dna: Map<string, ProductDNA>,
  shop: string,
): Promise<Kit[]> {
  if (!kits.length) return [];
  const client = new Anthropic({ apiKey: await getKey("claude-servikaki.env", "ANTHROPIC_API_KEY") });
  const brief = kits.map((k) => ({
    id: k.id,
    items: k.productIds.map((id) => ({
      name: products.get(id)?.name,
      category: products.get(id)?.categories[0],
      tastes: dna.get(id)?.interests,
    })),
  }));
  const res = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(Output) },
    system: `You name product kits for ${shop}, an independent shop. Each kit combines three products from different categories that the same kind of person loves. For each kit write a name of 2-4 words that evokes the moment or the person (not a list of the products), and a pitch of at most 16 words saying why these belong together. Plain, warm, specific. No exclamation marks, no puns that need explaining.`,
    messages: [{ role: "user", content: JSON.stringify(brief) }],
  });
  const named = new Map((res.parsed_output?.kits ?? []).map((k) => [k.id, k]));
  return kits.map((k) => ({ ...k, name: named.get(k.id)?.name ?? "", pitch: named.get(k.id)?.pitch ?? "" }));
}
