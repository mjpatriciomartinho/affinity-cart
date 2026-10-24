import type { QlooCall } from "./api.ts";

// Shows the real Qloo requests behind the current step, so it's always clear
// what the taste graph was asked and what it answered.

const SHOWN = ["filter.type", "query", "types", "filter.query", "signal.interests.entities", "signal.interests.tags", "signal.location.query", "take"];

const short = (v: string) =>
  v
    .split(",")
    .map((x) => x.replace(/^urn:tag:/, "tag:").replace(/^urn:entity:/, ""))
    .map((x) => (/^[0-9A-F-]{36}$/i.test(x) ? `${x.slice(0, 8)}…` : x))
    .join(", ");

export function Inspector({ calls, empty }: { calls: QlooCall[]; empty: string }) {
  const live = calls.filter((c) => !c.cached).length;
  return (
    <aside className="ac-inspector" aria-label="Qloo requests for this step">
      <div className="ac-inspector-head">
        <h3>Qloo requests</h3>
        {calls.length > 0 && (
          <span>
            {calls.length} calls, {live} live
          </span>
        )}
      </div>
      {calls.length === 0 ? (
        <p className="ac-muted">{empty}</p>
      ) : (
        <ol className="ac-calls">
          {[...calls].reverse().slice(0, 40).map((c, i) => (
            <li key={i}>
              <div className="ac-call-line">
                <code>GET {c.endpoint}</code>
                <span className="ac-muted">{c.cached ? "cached" : `${c.ms} ms`}</span>
              </div>
              <dl>
                {SHOWN.filter((k) => c.params[k]).map((k) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{short(c.params[k])}</dd>
                  </div>
                ))}
              </dl>
              {c.top.length > 0 && (
                <p className="ac-call-top">
                  {c.count} results: {c.top.slice(0, 4).join(", ")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
