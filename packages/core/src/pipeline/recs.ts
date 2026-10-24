import type { Qloo } from "../qloo.ts";
import type { Affinity, Kit, ProductDNA, Rec, Snapshot, SnapshotProduct } from "../types.ts";

// Step 4 — Recommendations. For each product Qloo answers "what else do people
// with this taste over-index on?" as a map of tags -> affinity. Another product
// scores by how strongly its own DNA tags appear in that map. Only other
// categories qualify: that's the point (no "bought a kettle, here's a kettle").

/** What people with a given taste over-index on, per Qloo. Entities are the
 * cross-domain signal (hiking taste -> Fleet Foxes, Into the Wild, Death
 * Stranding); tags cover products with no entity (house brands). Tags are keyed
 * by id and by normalised name: Qloo returns the same idea under several
 * namespaces (keyword:qloo:hiking vs keyword:media:hiking). */
export type TasteProfile = { entities: Map<string, Affinity>; tags: Map<string, Affinity> };
const nameKey = (name: string) => `name:${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;

export async function tasteProfile(
  qloo: Qloo,
  dna: ProductDNA[],
  opts: { location?: string; entityTypes: string[]; entities?: string[] },
): Promise<TasteProfile> {
  const tags = [...new Set(dna.flatMap((d) => d.tags.map((t) => t.id)))].slice(0, 6);
  // Extra entities: tastes that aren't products, e.g. a gift recipient's favourite band.
  const entities = [...new Set([...(opts.entities ?? []), ...dna.flatMap((d) => (d.entity ? [d.entity.id] : []))])].slice(0, 5);
  const signal = { tags, entities, location: opts.location };
  // One slow Qloo query shouldn't sink the whole profile: keep whatever answered.
  const settled = await Promise.allSettled([
    qloo.insights({ ...signal, filterType: "urn:tag", take: 50 }),
    ...opts.entityTypes.map((type) => qloo.insights({ ...signal, filterType: type, take: 50 })),
  ]);
  for (const r of settled) if (r.status === "rejected") console.warn("[recs] Qloo query failed:", (r.reason as Error).message);
  const [tagRes, ...entityRes] = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
  const profile: TasteProfile = { entities: new Map(), tags: new Map() };
  for (const e of entityRes.flat()) profile.entities.set(e.entity_id, { id: e.entity_id, name: e.name, affinity: e.query?.affinity ?? 0 });
  const put = (a: Affinity) => {
    for (const k of [a.id, nameKey(a.name)]) if ((profile.tags.get(k)?.affinity ?? -1) < a.affinity) profile.tags.set(k, a);
  };
  for (const t of tagRes) put({ id: t.tag_id ?? t.entity_id, name: t.name, affinity: t.query?.affinity ?? 0 });
  return profile;
}

// Entity matches are worth more than tag overlap: they're Qloo saying "these
// people love this specific thing", not "this is the same kind of thing".
const TAG_WEIGHT = 0.85;
// Below this a "match" is noise; better to show fewer, believable picks.
const MIN_SCORE = 0.4;

export function scoreAgainst(profile: TasteProfile, d: ProductDNA): { score: number; because: string[] } {
  const ent = d.entity ? profile.entities.get(d.entity.id) : undefined;
  const hits = d.tags
    .map((t) => ({ name: t.name, a: (profile.tags.get(t.id) ?? profile.tags.get(nameKey(t.name)))?.affinity ?? 0 }))
    .filter((h) => h.a > 0)
    .sort((x, y) => y.a - x.a);
  const tagScore = hits.length ? (TAG_WEIGHT * hits.reduce((s, h) => s + h.a, 0)) / Math.max(d.tags.length, 1) : 0;
  const score = Math.max(ent?.affinity ?? 0, tagScore);
  if (!score) return { score: 0, because: [] };
  const names = ent && ent.affinity >= tagScore ? [d.entity!.name, ...hits.map((h) => h.name)] : hits.map((h) => h.name);
  // Qloo often returns the same idea twice ("Travel", "travel"): keep distinct reasons only.
  const because = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()].slice(0, 2);
  return { score: Math.round(score * 1000) / 1000, because };
}

/** Entity types worth asking Qloo about: the ones this catalog's products map to. */
export const catalogEntityTypes = (dna: ProductDNA[]) => [...new Set(dna.flatMap((d) => (d.entity ? [d.entity.type] : [])))];

export function rank(
  profile: TasteProfile,
  candidates: SnapshotProduct[],
  dnaBy: Map<string, ProductDNA>,
  exclude: { ids: Set<string>; categories: Set<string> },
  take = 4,
): Rec[] {
  return candidates
    .filter((p) => !exclude.ids.has(p.id) && (p.stock === null || p.stock > 0))
    .filter((p) => !p.categories.some((c) => exclude.categories.has(c)))
    .map((p) => {
      const d = dnaBy.get(p.id);
      return d ? { productId: p.id, ...scoreAgainst(profile, d) } : null;
    })
    .filter((r): r is Rec => !!r && r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, take);
}

/** How much more often two products share a customer than chance would say (lift), capped to 0..1. */
export function coPurchase(snap: Snapshot): (a: string, b: string) => number {
  const owners = new Map<string, Set<string>>();
  for (const o of snap.orders)
    for (const it of o.items) {
      if (!o.customer) continue;
      const set = owners.get(it.productId) ?? new Set();
      set.add(o.customer);
      owners.set(it.productId, set);
    }
  const n = new Set(snap.orders.map((o) => o.customer).filter(Boolean)).size || 1;
  return (a, b) => {
    const A = owners.get(a);
    const B = owners.get(b);
    if (!A || !B || A.size < 2 || B.size < 2) return 0;
    let both = 0;
    for (const c of A) if (B.has(c)) both++;
    if (both < 2) return 0; // one shared customer is an anecdote, not a pattern
    const lift = (both * n) / (A.size * B.size);
    return Math.min(1, (lift - 1) / 4);
  };
}

const CO_PURCHASE_WEIGHT = 0.8;
export const CO_PURCHASE_REASON = "Bought together by your customers";

export async function buildRecs(qloo: Qloo, snap: Snapshot, dna: ProductDNA[]): Promise<Record<string, Rec[]>> {
  const dnaBy = new Map(dna.map((d) => [d.productId, d]));
  const together = coPurchase(snap);
  const out: Record<string, Rec[]> = {};
  for (const p of snap.products) {
    const d = dnaBy.get(p.id);
    if (!d) continue;
    const profile = await tasteProfile(qloo, [d], { location: snap.store.city, entityTypes: catalogEntityTypes(dna) });
    const exclude = { ids: new Set([p.id]), categories: new Set(p.categories) };
    const byQloo = rank(profile, snap.products, dnaBy, exclude, 8);
    // Where the taste graph is thin (e.g. niche games), the store's own order history fills in.
    const byOrders: Rec[] = snap.products
      .filter((q) => !exclude.ids.has(q.id) && !q.categories.some((c) => exclude.categories.has(c)) && (q.stock === null || q.stock > 0))
      .map((q) => ({ productId: q.id, score: Math.round(CO_PURCHASE_WEIGHT * together(p.id, q.id) * 1000) / 1000, because: [CO_PURCHASE_REASON] }))
      .filter((r) => r.score > 0);
    const best = new Map<string, Rec>();
    for (const r of [...byQloo, ...byOrders]) if ((best.get(r.productId)?.score ?? 0) < r.score) best.set(r.productId, r);
    out[p.id] = [...best.values()].filter((r) => r.score >= MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, 4);
  }
  return out;
}

/** Three-category kits: an anchor plus its two strongest recs, if they also suit each other. */
export function buildKits(snap: Snapshot, recs: Record<string, Rec[]>, count = 6): Omit<Kit, "name" | "pitch">[] {
  const byId = new Map(snap.products.map((p) => [p.id, p]));
  const scoreOf = (a: string, b: string) =>
    Math.max(recs[a]?.find((r) => r.productId === b)?.score ?? 0, recs[b]?.find((r) => r.productId === a)?.score ?? 0);
  const candidates: { productIds: string[]; score: number }[] = [];
  for (const [anchor, list] of Object.entries(recs))
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [b, c] = [list[i].productId, list[j].productId];
        const cats = new Set([anchor, b, c].map((id) => byId.get(id)?.categories[0]));
        if (cats.size < 3) continue;
        const s = (list[i].score + list[j].score + scoreOf(b, c)) / 3;
        candidates.push({ productIds: [anchor, b, c].sort(), score: s });
      }
  const seen = new Set<string>();
  const uses = new Map<string, number>();
  const kits: Omit<Kit, "name" | "pitch">[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    const key = c.productIds.join("|");
    if (seen.has(key) || c.productIds.some((id) => (uses.get(id) ?? 0) >= 2)) continue;
    seen.add(key);
    c.productIds.forEach((id) => uses.set(id, (uses.get(id) ?? 0) + 1));
    kits.push({ id: `kit-${kits.length + 1}`, productIds: c.productIds, score: Math.round(c.score * 1000) / 1000 });
    if (kits.length === count) break;
  }
  return kits;
}
