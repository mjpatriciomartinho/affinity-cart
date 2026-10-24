import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { wp, type State, type StepId } from "./api.ts";
import { Inspector } from "./Inspector.tsx";
import { CatalogPanel, GhostPanel, LivePanel, OverviewPanel, RecsPanel, TribesPanel } from "./panels.tsx";
import "./admin.css";

type Tab = "overview" | StepId | "live";

const TABS: { id: Tab; label: string; step?: StepId }[] = [
  { id: "overview", label: "Overview" },
  { id: "dna", label: "Catalog DNA", step: "dna" },
  { id: "tribes", label: "Customer tribes", step: "tribes" },
  { id: "ghost", label: "Ghost catalog", step: "ghost" },
  { id: "recs", label: "Recommendations & kits", step: "recs" },
  { id: "live", label: "Live shoppers" },
];

const tabFromHash = (): Tab => {
  const h = location.hash.slice(1) as Tab;
  return TABS.some((t) => t.id === h) ? h : "overview";
};

function App() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(tabFromHash);

  const refresh = useCallback(
    () =>
      wp<State>("/state").then(
        (s) => {
          setState(s);
          setError("");
        },
        (e) => setError(e.message),
      ),
    [],
  );
  const running = state && Object.values(state.steps).some((s) => s.status === "running");

  useEffect(() => {
    void refresh();
    const onHash = () => setTab(tabFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, running || tab === "live" || tab === "overview" ? 3000 : 10000);
    return () => clearInterval(t);
  }, [refresh, running, tab]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };
  const run = async (step: StepId) => {
    await wp(`/steps/${step}`, "POST");
    await refresh();
  };

  // The ghost catalog reasons over the tribes' brand queries, so those are its evidence.
  const calls =
    tab === "live"
      ? state?.live.flatMap((l) => (l.call ? [l.call] : [])) ?? []
      : tab === "ghost"
        ? state?.calls.tribes.filter((c) => c.params["filter.type"] === "urn:entity:brand") ?? []
        : tab === "overview"
          ? []
          : state?.calls[tab as StepId] ?? [];

  return (
    <div className="ac">
      <header className="ac-head">
        <h1>Affinity Cart</h1>
        {state?.local && (
          <span className={`ac-pill ${state.local.autopilot ? "is-on" : ""}`}>
            {running ? "Working" : state.local.autopilot ? "Autopilot on" : "Autopilot off"}
          </span>
        )}
      </header>
      {error && (
        <div className="notice notice-error">
          <p>Couldn't reach the Affinity Cart service: {error}</p>
        </div>
      )}

      <nav className="ac-steps" aria-label="Sections">
        <ul>
          {TABS.map((t) => {
            const st = t.step ? state?.steps[t.step] : undefined;
            return (
              <li key={t.id}>
                <button type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
                  {st && <span className={`ac-dot is-${st.status}`} aria-label={st.status} />}
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={tab === "overview" ? "ac-body ac-body-wide" : "ac-body"}>
        <main className="ac-main">
          {!state ? (
            <p className="ac-muted">Loading…</p>
          ) : tab === "overview" ? (
            <OverviewPanel state={state} refresh={refresh} go={go} />
          ) : tab === "dna" ? (
            <CatalogPanel state={state} run={() => run("dna")} />
          ) : tab === "tribes" ? (
            <TribesPanel state={state} run={() => run("tribes")} refresh={refresh} />
          ) : tab === "ghost" ? (
            <GhostPanel state={state} run={() => run("ghost")} refresh={refresh} />
          ) : tab === "recs" ? (
            <RecsPanel state={state} run={() => run("recs")} refresh={refresh} />
          ) : (
            <LivePanel state={state} />
          )}
        </main>
        {tab !== "overview" && (
          <Inspector calls={calls} empty={tab === "live" ? "Each shopper request shows up here." : "Run this step to see what Qloo is asked."} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("affinity-cart-admin")!).render(<App />);
