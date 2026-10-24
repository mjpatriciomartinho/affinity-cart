import { useMemo, useState, type ReactNode } from "react";
import { ago, env, money, pct, wp, type Product, type State, type StepId, type StepInfo } from "./api.ts";

type Refresh = () => Promise<void>;
type StepProps = { state: State; run: () => Promise<void> };

const tagLabel = (id: string) => id.replace(/^urn:tag:/, "").split(":").slice(0, -1).join(":");
const SOURCES: Record<string, string> = {
  vibe: "Complete the vibe",
  kit: "Kits",
  live: "Picked for you",
  gift: "Gift finder",
};
const STEP_NAMES: Record<StepId, string> = {
  dna: "Catalog DNA",
  tribes: "Customer tribes",
  ghost: "Ghost catalog",
  recs: "Recommendations & kits",
};

function useProducts(state: State) {
  return useMemo(() => new Map(state.products.map((p) => [p.id, p])), [state.products]);
}

/** A button that shows its own busy state and error. */
function Action({ label, busyLabel, onClick, primary, disabled }: {
  label: string;
  busyLabel?: string;
  onClick: () => Promise<unknown>;
  primary?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <span className="ac-action">
      <button
        type="button"
        className={primary ? "button button-primary" : "button"}
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await onClick();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? busyLabel ?? "Working…" : label}
      </button>
      {err && <span className="ac-err">{err}</span>}
    </span>
  );
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`ac-switch ${on ? "is-on" : ""}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onChange(!on);
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="ac-switch-track" aria-hidden="true" />
      {label}
    </button>
  );
}

function StepHead({ title, lede, info, rerun, children }: {
  title: string;
  lede: ReactNode;
  info?: StepInfo;
  rerun?: () => Promise<void>;
  children?: ReactNode;
}) {
  return (
    <div className="ac-step-head">
      <div className="ac-step-title">
        <h2>{title}</h2>
        {info?.status === "running" ? (
          <span className="ac-status is-running">{info.progress ?? "Working…"}</span>
        ) : info?.finishedAt ? (
          <span className="ac-status">Updated {ago(info.finishedAt)}</span>
        ) : null}
      </div>
      <p className="ac-lede">{lede}</p>
      <div className="ac-actions">
        {children}
        {rerun && (
          <Action label={info?.status === "done" ? "Run again" : "Run now"} onClick={rerun} disabled={info?.status === "running"} />
        )}
      </div>
      {info?.status === "error" && (
        <div className="notice notice-error inline">
          <p>{info.error}</p>
        </div>
      )}
    </div>
  );
}

// ---------- Overview ----------

export function OverviewPanel({ state, refresh, go }: { state: State; refresh: Refresh; go: (t: StepId | "live") => void }) {
  const a = state.attribution;
  const l = state.local;
  const running = (Object.keys(state.steps) as StepId[]).find((s) => state.steps[s].status === "running");
  const setting = async (body: Record<string, boolean>) => {
    await wp("/settings", "POST", body);
    await refresh();
  };
  const sources = Object.entries(a.bySource ?? {}).filter(([, v]) => v > 0);
  const maxSource = Math.max(1, ...sources.map(([, v]) => v));

  return (
    <div className="ac-overview">
      <div className="ac-col">
      <section className="ac-card ac-money" aria-labelledby="ac-money-h">
        <h2 id="ac-money-h">Revenue from Affinity Cart</h2>
        <p className="ac-figure">{money(a.attributed)}</p>
        <p className="ac-muted">
          {a.attributedOrders
            ? `${a.attributedOrders} ${a.attributedOrders === 1 ? "order" : "orders"} included a pick, ${pct(a.revenue ? a.attributed / a.revenue : 0)} of ${money(a.revenue)} in total.`
            : "No orders with picks yet. Every product added from an Affinity Cart block is counted here."}
        </p>
        {sources.length > 0 && (
          <ul className="ac-sources">
            {sources.map(([k, v]) => (
              <li key={k}>
                <span>{SOURCES[k] ?? k}</span>
                <span className="ac-source-bar">
                  <span style={{ width: `${(v / maxSource) * 100}%` }} />
                </span>
                <strong>{money(v)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ac-card ac-shopfront" aria-labelledby="ac-shop-h">
        <div className="ac-card-head">
          <h2 id="ac-shop-h">In your shop</h2>
          <a className="button" href={env().shopUrl} target="_blank" rel="noreferrer">
            Open the shop
          </a>
        </div>
        <ul className="ac-features">
          <li>
            <strong>Picked for you</strong>
            <span className="ac-muted">A row and badges on the shop page, personalised by city and browsing.</span>
          </li>
          <li>
            <strong>Complete the vibe</strong>
            <span className="ac-muted">Cross-category picks with reasons on every product page and in the cart.</span>
          </li>
          <li>
            <strong>Kits</strong>
            <span className="ac-muted">
              {Object.keys(l.kits).length} published as products, {Math.round(0.1 * 100)}% off when bought together.
            </span>
          </li>
          <li>
            <strong>Gift finder</strong>
            <span className="ac-muted">A floating button: shoppers say what the recipient loves, Qloo and Claude pick from your stock.</span>
            <Toggle on={l.giftFinder} label={l.giftFinder ? "Shown" : "Hidden"} onChange={(v) => setting({ giftFinder: v })} />
          </li>
        </ul>
      </section>

      </div>
      <div className="ac-col">
      <section className="ac-card ac-autopilot" aria-labelledby="ac-auto-h">
        <div className="ac-card-head">
          <h2 id="ac-auto-h">Autopilot</h2>
          <Toggle on={l.autopilot} label={l.autopilot ? "On" : "Off"} onChange={(v) => setting({ autopilot: v })} />
        </div>
        <p className="ac-muted">
          {l.autopilot
            ? "Re-reads your store after new orders and every hour, re-runs the analysis and writes fresh cross-sells and kits into WooCommerce."
            : "Off: results are only written to WooCommerce when you apply them."}
        </p>
        <ul className="ac-pipeline">
          {(Object.keys(STEP_NAMES) as StepId[]).map((s) => {
            const st = state.steps[s];
            return (
              <li key={s}>
                <span className={`ac-dot is-${st.status}`} />
                <button type="button" className="ac-link" onClick={() => go(s)}>
                  {STEP_NAMES[s]}
                </button>
                <span className="ac-muted">{st.status === "running" ? st.progress ?? "Working…" : st.status === "error" ? "Failed" : st.finishedAt ? ago(st.finishedAt) : "Not run"}</span>
              </li>
            );
          })}
        </ul>
        <div className="ac-actions">
          <Action
            primary
            label="Refresh everything now"
            busyLabel="Starting…"
            disabled={!!running}
            onClick={async () => {
              await wp("/run", "POST");
              await refresh();
            }}
          />
          <span className="ac-muted">
            {state.counts.products} products, {state.counts.customers} customers, {state.counts.orders} orders read {ago(state.syncedAt)}.
          </span>
        </div>
      </section>

      <section className="ac-card ac-log" aria-labelledby="ac-log-h">
        <h2 id="ac-log-h">Activity</h2>
        {l.log.length === 0 ? (
          <p className="ac-muted">Nothing yet. Autopilot's actions and yours will be listed here.</p>
        ) : (
          <ul>
            {l.log.slice(0, 12).map((e, i) => (
              <li key={i}>
                <span>{e.text}</span>
                <time className="ac-muted" dateTime={e.at}>
                  {ago(e.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}

// ---------- Catalog DNA ----------

export function CatalogPanel({ state, run }: StepProps) {
  const dna = new Map(state.dna.map((d) => [d.productId, d]));
  const mapped = state.dna.filter((d) => d.entity).length;
  return (
    <>
      <StepHead
        title="Catalog DNA"
        lede={`Qloo knows culture, not SKUs, so an agent maps each product to Qloo: the work itself (a book, artist or game), its brand, and the interests behind it. ${state.dna.length} of ${state.products.length} products mapped, ${mapped} to a Qloo entity.`}
        info={state.steps.dna}
        rerun={run}
      />
      <table className="wp-list-table widefat striped ac-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qloo entity</th>
            <th>Qloo tags</th>
            <th>How it was decided</th>
          </tr>
        </thead>
        <tbody>
          {state.products.map((p) => {
            const d = dna.get(p.id);
            return (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="ac-muted">{p.categories.join(", ")}</div>
                </td>
                <td>
                  {d?.entity ? (
                    <span className="ac-entity" title={d.entity.id}>
                      {d.entity.name}
                      <small>{d.entity.type.replace("urn:entity:", "")}</small>
                    </span>
                  ) : (
                    <span className="ac-muted">{d ? "Interests only" : "Not mapped yet"}</span>
                  )}
                </td>
                <td>
                  <div className="ac-chips">
                    {d?.tags.map((t) => (
                      <span key={t.id} className="ac-chip" title={t.id}>
                        {t.name}
                        <small>{tagLabel(t.id)}</small>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="ac-note">{d?.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// ---------- Tribes ----------

function download(name: string, csv: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function TribesPanel({ state, run, refresh }: StepProps & { refresh: Refresh }) {
  const products = useProducts(state);
  return (
    <>
      <StepHead
        title="Customer tribes"
        lede="Customers grouped by the taste of what they bought, and what else each group loves according to Qloo, given where they live. Export a tribe to target it in your newsletter: emails never leave WordPress."
        info={state.steps.tribes}
        rerun={run}
      />
      <div className="ac-tribes">
        {state.tribes.map((t) => (
          <article key={t.id} className="ac-card ac-tribe">
            <header>
              <h3>{t.name || t.topTags.slice(0, 2).map((x) => x.tag.name).join(" & ")}</h3>
              <span className="ac-share">{pct(t.share)} of revenue</span>
            </header>
            {t.description && <p>{t.description}</p>}
            <p className="ac-muted">
              {t.customers} customers, {money(t.revenue)}, mostly in {t.cities.slice(0, 2).map((c) => c.city).join(" and ")}.
            </p>
            <div className="ac-chips">
              {t.topTags.map((x) => (
                <span key={x.tag.id} className="ac-chip" title={x.tag.id}>
                  {x.tag.name}
                </span>
              ))}
            </div>
            <dl className="ac-culture">
              <dt>Buys here</dt>
              <dd>{t.topProducts.slice(0, 3).map((id) => products.get(id)?.name).filter(Boolean).join(", ")}</dd>
              {t.culture && (
                <>
                  <dt>Also loves</dt>
                  <dd>{t.culture.brands.slice(0, 4).map((b) => b.name).join(", ")}</dd>
                  <dt>Listens to</dt>
                  <dd>{t.culture.artists.slice(0, 3).map((b) => b.name).join(", ")}</dd>
                  <dt>Watches</dt>
                  <dd>{t.culture.movies.slice(0, 3).map((b) => b.name).join(", ")}</dd>
                </>
              )}
            </dl>
            <div className="ac-actions">
              <Action
                label="Export for a campaign"
                busyLabel="Exporting…"
                onClick={async () => {
                  const res = await wp<{ csv: string; count: number }>(`/tribes/${t.id}/export`, "POST");
                  download(`${(t.name || t.id).toLowerCase().replace(/\W+/g, "-")}.csv`, res.csv);
                  await refresh();
                }}
              />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

// ---------- Ghost catalog ----------

export function GhostPanel({ state, run, refresh }: StepProps & { refresh: Refresh }) {
  const tribeName = new Map(state.tribes.map((t) => [t.id, t.name || t.id]));
  const tribeSize = new Map(state.tribes.map((t) => [t.id, t.customers]));
  const totalCustomers = state.tribes.reduce((s, t) => s + t.customers, 0) || 1;
  const strongest = (evidence: string[]) => Math.max(0, ...evidence.map((e) => Number(e.match(/0\.\d+/)?.[0] ?? 0)));
  return (
    <>
      <StepHead
        title="Ghost catalog"
        lede="What your own customers would buy if you sold it: brands each tribe over-indexes on in Qloo, that you don't stock. Turn any of them into a draft product to start sourcing."
        info={state.steps.ghost}
        rerun={run}
      />
      <ol className="ac-ghost">
        {state.ghost.map((g, i) => {
          const draft = state.local.drafts[g.title];
          return (
            <li key={g.title} className="ac-card">
              <div className="ac-ghost-top">
                <h3>{g.title}</h3>
                <span className="ac-share">
                  {(() => {
                    const n = g.tribeIds.reduce((s, id) => s + (tribeSize.get(id) ?? 0), 0);
                    const top = strongest(g.evidence);
                    return `${n} of your ${totalCustomers} customers${top ? `, up to ${pct(top)} affinity` : ""}`;
                  })()}
                </span>
              </div>
              <p>{g.why}</p>
              <p className="ac-muted">
                For {g.tribeIds.map((id) => tribeName.get(id)).join(", ")}
                {g.examples.length > 0 && <>. Brands to look at: {g.examples.join(", ")}</>}
              </p>
              <div className="ac-chips">
                {g.evidence.map((e) => (
                  <span key={e} className="ac-chip ac-chip-evidence">
                    {e.replace(/tribe-\d+/g, (id) => tribeName.get(id) ?? id)}
                  </span>
                ))}
              </div>
              <div className="ac-actions">
                {draft ? (
                  <a className="button" href={draft.editUrl} target="_blank" rel="noreferrer">
                    Edit draft product
                  </a>
                ) : (
                  <Action
                    label="Create draft product"
                    busyLabel="Creating…"
                    onClick={async () => {
                      await wp(`/ghost/${i}/draft`, "POST");
                      await refresh();
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ---------- Recommendations & kits ----------

export function RecsPanel({ state, run, refresh }: StepProps & { refresh: Refresh }) {
  const products = useProducts(state);
  const withRecs = state.products.filter((p) => state.recs[p.id]?.length);
  const [selected, setSelected] = useState<string>();
  const current = selected ?? withRecs[0]?.id;
  const applied = state.local.appliedAt;

  return (
    <>
      <StepHead
        title="Recommendations & kits"
        lede={
          state.local.autopilot
            ? `For each product, what people with its taste love in other categories. Autopilot writes them into WooCommerce as cross-sells and publishes the kits; last applied ${ago(applied)}.`
            : "For each product, what people with its taste love in other categories. Apply them to write them into WooCommerce as cross-sells and publish the kits."
        }
        info={state.steps.recs}
        rerun={run}
      >
        <Action
          primary={!state.local.autopilot}
          label="Apply to WooCommerce now"
          busyLabel="Applying…"
          disabled={!withRecs.length}
          onClick={async () => {
            await wp("/apply", "POST");
            await refresh();
          }}
        />
      </StepHead>

      {state.kits.length > 0 && (
        <>
          <h3 className="ac-section">Kits</h3>
          <div className="ac-kits">
            {state.kits.map((k) => {
              const pub = state.local.kits[k.id];
              const total = k.productIds.reduce((s, id) => s + (products.get(id)?.price ?? 0), 0);
              return (
                <article key={k.id} className="ac-card">
                  <h4>{k.name}</h4>
                  <p>{k.pitch}</p>
                  <ul>
                    {k.productIds.map((id) => (
                      <li key={id}>{products.get(id)?.name}</li>
                    ))}
                  </ul>
                  <p className="ac-muted">
                    <span className="ac-score">{pct(k.score)} taste match</span>, {money(total * 0.9)} as a kit
                  </p>
                  {pub ? (
                    <a className="button" href={pub.url} target="_blank" rel="noreferrer">
                      View in shop
                    </a>
                  ) : (
                    <Action
                      label="Publish kit"
                      busyLabel="Publishing…"
                      onClick={async () => {
                        await wp(`/kits/${k.id}/publish`, "POST");
                        await refresh();
                      }}
                    />
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {withRecs.length > 0 && (
        <>
          <h3 className="ac-section">Cross-sells by product</h3>
          <div className="ac-recs">
            <ul className="ac-recs-list" aria-label="Products">
              {withRecs.map((p) => (
                <li key={p.id}>
                  <button type="button" aria-pressed={p.id === current} onClick={() => setSelected(p.id)}>
                    {p.name}
                    <small>{p.categories[0]}</small>
                  </button>
                </li>
              ))}
            </ul>
            <div className="ac-recs-detail">{current && <RecDetail product={products.get(current)!} state={state} />}</div>
          </div>
        </>
      )}
    </>
  );
}

function RecDetail({ product, state }: { product: Product; state: State }) {
  const products = useProducts(state);
  const dna = state.dna.find((d) => d.productId === product.id);
  return (
    <>
      <h3>{product.name}</h3>
      <p className="ac-muted">
        Taste: {dna?.entity ? `${dna.entity.name}, ` : ""}
        {dna?.tags.map((t) => t.name).join(", ")}
      </p>
      <ol className="ac-reclist">
        {state.recs[product.id].map((r) => {
          const p = products.get(r.productId);
          return (
            <li key={r.productId}>
              <div>
                <strong>{p?.name}</strong>
                <span className="ac-muted"> {p?.categories[0]}</span>
                <p className="ac-because">
                  {r.because[0] === state.coPurchaseReason
                    ? r.because[0]
                    : `People who love ${dna?.entity?.name ?? product.name} also love ${r.because.join(" and ")}`}
                </p>
              </div>
              <Meter value={r.score} />
            </li>
          );
        })}
      </ol>
      {product.url && (
        <a className="button" href={product.url} target="_blank" rel="noreferrer">
          See it on the product page
        </a>
      )}
    </>
  );
}

// ---------- Live shoppers ----------

const CITIES = ["Madrid", "Barcelona", "Lisbon", "Berlin", "Valencia", "Bilbao"];

export function LivePanel({ state }: { state: State }) {
  const products = useProducts(state);
  const [city, setCity] = useState("Berlin");
  const shop = `${env().shopUrl}${env().shopUrl.includes("?") ? "&" : "?"}affinity_city=${encodeURIComponent(city)}`;
  return (
    <>
      <StepHead
        title="Live shoppers"
        lede="Every shopper gets their own shop: their city (from your CDN) and what they've viewed this session go to Qloo, which re-ranks the shop for them. That drives the 'Picked for you' row and badges, live."
      >
        <label className="ac-inline">
          Preview as a shopper in{" "}
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <a className="button button-primary" href={shop} target="_blank" rel="noreferrer">
          Open the shop
        </a>
      </StepHead>
      {state.live.length === 0 ? (
        <p className="ac-muted">No shoppers yet. Open the shop and look at a couple of products.</p>
      ) : (
        <table className="wp-list-table widefat striped ac-table">
          <thead>
            <tr>
              <th>When</th>
              <th>City</th>
              <th>Looked at</th>
              <th>Shown to them</th>
            </tr>
          </thead>
          <tbody>
            {state.live.map((l, i) => (
              <tr key={i}>
                <td>{ago(l.at)}</td>
                <td>{l.visitor.city || "Unknown"}</td>
                <td>{l.visitor.viewed.length ? l.visitor.viewed.map((id) => products.get(id)?.name).filter(Boolean).join(", ") : <span className="ac-muted">Nothing yet (first visit)</span>}</td>
                <td>{l.recs.map((r) => products.get(r.productId)?.name).filter(Boolean).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="ac-meter" role="img" aria-label={`${pct(value)} taste match`}>
      <span style={{ width: pct(value) }} />
      <em>{pct(value)}</em>
    </div>
  );
}
