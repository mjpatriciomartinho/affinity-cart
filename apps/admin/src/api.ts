// Talks to the plugin's own REST routes (which proxy to the Affinity Cart
// service), authenticated with the standard wp_rest nonce.

declare global {
  interface Window {
    AffinityCartAdmin: { rest: string; nonce: string; shopUrl: string; currency: string; apiUrl: string };
  }
}

export const env = () => window.AffinityCartAdmin;

export async function wp<T>(path: string, method: "GET" | "POST" = "GET", body: unknown = {}): Promise<T> {
  const res = await fetch(`${env().rest}${path}`, {
    method,
    headers: { "X-WP-Nonce": env().nonce, "Content-Type": "application/json" },
    credentials: "same-origin",
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const money = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const ago = (iso?: string | number) => {
  if (!iso) return "never";
  const t = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString();
};

export type Ref = { id: string; name: string; type: string };
export type Affinity = { id: string; name: string; affinity: number; tags?: string[] };
export type Product = { id: string; sku: string; name: string; brand: string; categories: string[]; price: number; stock: number | null; url?: string };
export type QlooCall = { at: string; endpoint: string; params: Record<string, string>; ms: number; cached: boolean; count: number; top: string[] };
export type StepId = "dna" | "tribes" | "ghost" | "recs";
export type StepInfo = { status: "idle" | "running" | "done" | "error"; progress?: string; error?: string; finishedAt?: string; qlooCalls: number };
export type Rec = { productId: string; score: number; because: string[]; product?: Product };
export type Tribe = {
  id: string;
  name: string;
  description?: string;
  customers: number;
  members: string[];
  revenue: number;
  share: number;
  topTags: { tag: Ref; weight: number }[];
  topEntities: Ref[];
  topProducts: string[];
  cities: { city: string; customers: number }[];
  culture?: { brands: Affinity[]; artists: Affinity[]; movies: Affinity[]; tags: Affinity[] };
};
export type Ghost = { title: string; kind: "brand" | "category"; examples: string[]; tribeIds: string[]; audienceShare: number; evidence: string[]; why: string };
export type Kit = { id: string; productIds: string[]; score: number; name: string; pitch: string };
export type DNA = { productId: string; entity?: Ref; tags: Ref[]; interests: string[]; note: string };

export type State = {
  store?: { name: string; url: string; city: string; country: string };
  syncedAt?: string;
  counts: { products: number; customers: number; orders: number };
  steps: Record<StepId, StepInfo>;
  products: Product[];
  dna: DNA[];
  tribes: Tribe[];
  ghost: Ghost[];
  recs: Record<string, Rec[]>;
  kits: Kit[];
  live: { at: string; visitor: { id: string; city?: string; viewed: string[] }; recs: Rec[]; call?: QlooCall }[];
  calls: Record<StepId, QlooCall[]>;
  attribution: { orders: number; revenue: number; attributed: number; attributedOrders: number; bySource: Record<string, number> };
  coPurchaseReason: string;
  local: {
    autopilot: boolean;
    giftFinder: boolean;
    log: { at: string; text: string }[];
    appliedAt: number;
    kits: Record<string, { postId: number; url: string }>;
    drafts: Record<string, { postId: number; editUrl: string }>;
  };
};

export type SyncResult = {
  read: { products: number; customers: number; orders: number; sample: { customer: unknown; order: unknown } };
};
