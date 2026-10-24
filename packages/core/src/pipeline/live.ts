import type { Qloo } from "../qloo.ts";
import type { ProductDNA, Rec, Snapshot, Tribe } from "../types.ts";
import { rank, tasteProfile } from "./recs.ts";

// Step 5 — Live visitor. No account, no history: just where they are (city from
// the CDN's geo headers) and what they've looked at this session. That's
// enough for Qloo to re-rank the shop for them.

export type Visitor = { id: string; city?: string; country?: string; viewed: string[] };

export async function recommendForVisitor(
  qloo: Qloo,
  snap: Snapshot,
  dna: ProductDNA[],
  visitor: Visitor,
  take = 4,
  tribes: Tribe[] = [],
): Promise<Rec[]> {
  const dnaBy = new Map(dna.map((d) => [d.productId, d]));
  let viewed = visitor.viewed.slice(-3).map((id) => dnaBy.get(id)).filter((d): d is ProductDNA => !!d);
  // Cold start: nothing viewed yet, so borrow the taste of the tribe that
  // dominates the visitor's city (or the store's biggest tribe).
  if (!viewed.length) {
    const local = tribes.find((t) => t.cities[0]?.city === visitor.city) ?? tribes[0];
    viewed = (local?.topProducts ?? []).slice(0, 3).map((id) => dnaBy.get(id)).filter((d): d is ProductDNA => !!d);
  }
  if (!viewed.length) return [];
  // Shoppers are waiting: ask only about the entity types most of the catalog maps to.
  const counts = new Map<string, number>();
  for (const d of dna) if (d.entity) counts.set(d.entity.type, (counts.get(d.entity.type) ?? 0) + 1);
  const entityTypes = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  const profile = await tasteProfile(qloo, viewed, { location: visitor.city, entityTypes });
  const viewedCats = new Set(
    snap.products.filter((p) => visitor.viewed.includes(p.id)).flatMap((p) => p.categories),
  );
  return rank(profile, snap.products, dnaBy, { ids: new Set(visitor.viewed), categories: viewedCats }, take);
}
