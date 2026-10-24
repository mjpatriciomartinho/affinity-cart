import type { Qloo, QlooEntity } from "../qloo.ts";
import type { Affinity, ProductDNA, QlooRef, Snapshot, Tribe } from "../types.ts";

// Step 2 — Customers & tribes. Each customer becomes a taste vector (the DNA of
// everything they bought); k-means groups them; Qloo then profiles each tribe's
// wider culture, using where they live as the location signal.

type Vec = Map<string, number>;

export function findTribes(snap: Snapshot, dna: ProductDNA[], k?: number): Tribe[] {
  const dnaBy = new Map(dna.map((d) => [d.productId, d]));
  const refs = new Map<string, QlooRef>();
  const vectors = new Map<string, Vec>();
  const revenue = new Map<string, number>();
  const bought = new Map<string, Map<string, number>>();

  for (const o of snap.orders) {
    if (!o.customer) continue;
    const v = vectors.get(o.customer) ?? new Map();
    const b = bought.get(o.customer) ?? new Map();
    for (const it of o.items) {
      const d = dnaBy.get(it.productId);
      b.set(it.productId, (b.get(it.productId) ?? 0) + it.qty);
      if (!d) continue;
      for (const r of [...d.tags, ...(d.entity ? [d.entity] : [])]) {
        refs.set(r.id, r);
        v.set(r.id, (v.get(r.id) ?? 0) + it.qty);
      }
    }
    vectors.set(o.customer, v);
    bought.set(o.customer, b);
    revenue.set(o.customer, (revenue.get(o.customer) ?? 0) + o.total);
  }

  const ids = [...vectors.keys()].filter((id) => vectors.get(id)!.size);
  const kk = k ?? Math.min(5, Math.max(2, Math.round(Math.sqrt(ids.length / 4))));
  const assign = kmeans(ids.map((id) => normalize(vectors.get(id)!)), kk);

  const cityOf = new Map(snap.customers.map((c) => [c.id, c.city]));
  const total = [...revenue.values()].reduce((s, x) => s + x, 0) || 1;
  const tribes: Tribe[] = [];
  for (let t = 0; t < kk; t++) {
    const members = ids.filter((_, i) => assign[i] === t);
    if (!members.length) continue;
    const centroid: Vec = new Map();
    const products = new Map<string, number>();
    const cities = new Map<string, number>();
    for (const m of members) {
      for (const [id, w] of normalize(vectors.get(m)!)) centroid.set(id, (centroid.get(id) ?? 0) + w / members.length);
      for (const [pid, q] of bought.get(m)!) products.set(pid, (products.get(pid) ?? 0) + q);
      const city = cityOf.get(m) ?? "Unknown";
      cities.set(city, (cities.get(city) ?? 0) + 1);
    }
    const ranked = [...centroid].sort((a, b) => b[1] - a[1]).map(([id, w]) => ({ ref: refs.get(id)!, w }));
    const rev = members.reduce((s, m) => s + (revenue.get(m) ?? 0), 0);
    tribes.push({
      id: `tribe-${t + 1}`,
      name: "",
      customers: members.length,
      members,
      revenue: round(rev),
      share: round(rev / total),
      topTags: ranked.filter((r) => r.ref.id.startsWith("urn:tag")).slice(0, 6).map((r) => ({ tag: r.ref, weight: round(r.w) })),
      topEntities: ranked.filter((r) => r.ref.id.startsWith("urn:tag") === false).slice(0, 4).map((r) => r.ref),
      topProducts: [...products].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([pid]) => pid),
      cities: [...cities].sort((a, b) => b[1] - a[1]).map(([city, customers]) => ({ city, customers })),
    });
  }
  return tribes.sort((a, b) => b.revenue - a.revenue).map((t, i) => ({ ...t, id: `tribe-${i + 1}` }));
}

/** What else each tribe loves, according to Qloo, given their tastes and where they live. */
export async function profileTribeCulture(qloo: Qloo, tribe: Tribe): Promise<NonNullable<Tribe["culture"]>> {
  const base = {
    tags: tribe.topTags.slice(0, 4).map((t) => t.tag.id),
    entities: tribe.topEntities.slice(0, 3).map((e) => e.id),
    location: tribe.cities[0]?.city,
  };
  const [brands, artists, movies, tags] = await Promise.all([
    qloo.insights({ ...base, filterType: "urn:entity:brand", take: 30 }),
    qloo.insights({ ...base, filterType: "urn:entity:artist", take: 8 }),
    qloo.insights({ ...base, filterType: "urn:entity:movie", take: 8 }),
    qloo.insights({ ...base, filterType: "urn:tag", take: 25 }),
  ]);
  return { brands: brands.map(aff), artists: artists.map(aff), movies: movies.map(aff), tags: tags.map(aff) };
}

const aff = (e: QlooEntity): Affinity => ({
  id: e.tag_id ?? e.entity_id,
  name: e.name,
  affinity: round(e.query?.affinity ?? 0),
  tags: (e.tags ?? []).filter((t) => t.type === "urn:tag:genre:brand").map((t) => t.name).slice(0, 2),
});

function normalize(v: Vec): Vec {
  const n = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
  return new Map([...v].map(([k, x]) => [k, x / n]));
}

const dot = (a: Vec, b: Vec) => {
  let s = 0;
  for (const [k, x] of a) s += x * (b.get(k) ?? 0);
  return s;
};

// Cosine k-means with deterministic farthest-point seeding (stable results run to run).
function kmeans(points: Vec[], k: number): number[] {
  const centers: Vec[] = [points[0]];
  while (centers.length < k) {
    let best = 0;
    let bestSim = Infinity;
    points.forEach((p, i) => {
      const sim = Math.max(...centers.map((c) => dot(p, c)));
      if (sim < bestSim) [best, bestSim] = [i, sim];
    });
    centers.push(points[best]);
  }
  let assign: number[] = [];
  for (let iter = 0; iter < 20; iter++) {
    const next = points.map((p) => centers.map((c) => dot(p, c)).reduce((bi, s, i, arr) => (s > arr[bi] ? i : bi), 0));
    if (next.every((a, i) => a === assign[i])) break;
    assign = next;
    for (let c = 0; c < k; c++) {
      const members = points.filter((_, i) => assign[i] === c);
      if (!members.length) continue;
      const sum: Vec = new Map();
      for (const m of members) for (const [key, x] of m) sum.set(key, (sum.get(key) ?? 0) + x);
      centers[c] = normalize(sum);
    }
  }
  return assign;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
