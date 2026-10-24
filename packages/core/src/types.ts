// What the WooCommerce plugin sends on sync. Customers arrive pseudonymised:
// no names or emails ever leave the store, only city/country and purchases.

export type SnapshotProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  categories: string[];
  price: number;
  stock: number | null; // null = not managed
  description: string;
  url?: string;
  image?: string;
};

export type SnapshotCustomer = { id: string; city: string; country: string };

export type SnapshotOrder = {
  id: string;
  customer: string | null;
  date: string;
  city: string;
  country: string;
  total: number;
  discount?: number; // Affinity Cart kit discounts on this order (positive amount)
  items: { productId: string; qty: number; total: number; source?: string }[];
};

export type Snapshot = {
  store: { id: string; name: string; url: string; currency: string; city: string; country: string };
  syncedAt: string;
  products: SnapshotProduct[];
  customers: SnapshotCustomer[];
  orders: SnapshotOrder[];
};

// ---- Pipeline outputs ----

export type QlooRef = { id: string; name: string; type: string };

/** Step 1: a product translated into the taste graph. */
export type ProductDNA = {
  productId: string;
  entity?: QlooRef; // the product itself (book, album, game) or its brand, when Qloo knows it
  tags: QlooRef[]; // verified Qloo tags, e.g. urn:tag:keyword:qloo:hiking
  interests: string[]; // plain-language version for the merchant UI
  note: string; // one line: how the agent decided
};

/** Step 2: customers grouped by shared taste. */
export type Tribe = {
  id: string;
  name: string;
  customers: number;
  members: string[]; // pseudonymous customer ids; only the plugin can map them back
  revenue: number;
  share: number; // of total revenue
  topTags: { tag: QlooRef; weight: number }[];
  topEntities: QlooRef[];
  topProducts: string[];
  cities: { city: string; customers: number }[];
  culture?: { brands: Affinity[]; artists: Affinity[]; movies: Affinity[]; tags: Affinity[] };
};

export type Affinity = { id: string; name: string; affinity: number; tags?: string[] };

/** Step 3: what the tribes love that the store doesn't sell. */
export type GhostItem = {
  title: string;
  kind: "brand" | "category";
  examples: string[];
  tribeIds: string[];
  audienceShare: number; // share of the store's revenue coming from those tribes
  evidence: string[]; // concrete Qloo signals, e.g. "Buff 0.98 for trail tribe in Madrid"
  why: string;
};

/** Step 4: cross-category recommendations. */
export type Rec = { productId: string; score: number; because: string[] };
export type Kit = { id: string; productIds: string[]; score: number; name: string; pitch: string };
