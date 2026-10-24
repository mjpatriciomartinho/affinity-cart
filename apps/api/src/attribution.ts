import type { StoreState } from "@affinity-cart/core";

/** Revenue from order lines added through an Affinity Cart block, net of our kit discounts. */
export function attribution(s: StoreState) {
  const orders = s.snapshot?.orders ?? [];
  let revenue = 0;
  let attributed = 0;
  let attributedOrders = 0;
  const bySource: Record<string, number> = {};
  for (const o of orders) {
    revenue += o.total;
    const lines = o.items.filter((i) => i.source);
    if (!lines.length) continue;
    for (const i of lines) bySource[i.source!] = (bySource[i.source!] ?? 0) + i.total;
    // Kit discounts are ours to give, so they come off what we take credit for.
    if (o.discount) bySource.kit = (bySource.kit ?? 0) - o.discount;
    attributed += lines.reduce((sum, i) => sum + i.total, 0) - (o.discount ?? 0);
    attributedOrders++;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const recent = [...orders].reverse().filter((o) => o.items.some((i) => i.source)).slice(0, 10);
  return {
    orders: orders.length,
    revenue: round2(revenue),
    attributed: round2(attributed),
    attributedOrders,
    bySource: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, round2(v)])),
    recent,
  };
}
