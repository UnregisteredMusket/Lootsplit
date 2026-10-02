import { useEffect, useRef, useState, type FormEvent } from "react";
import { accountRequest } from "@/lib/account/client";
import { APP_VERSION } from "@/lib/quire/version";

const statuses = ["new", "reviewing", "planned", "fixed", "closed"];
const areas = [
  "general",
  "accounts",
  "campaigns",
  "multiplayer",
  "inventory",
  "shops",
  "imports",
  "android",
  "website",
];
type Report = {
  id: string;
  title: string;
  area: string;
  status: string;
  priority: string;
  created_at: number;
  updated_at: number;
};
type Detail = Report & {
  description: string;
  steps: string;
  expected: string;
  diagnostics: Record<string, string>;
  response: string;
  revision: number;
  history: { status: string; priority: string; response: string; created_at: number }[];
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to complete this request. Please try again.";
export function BugReports({ userId, role }: { userId?: string; role?: string }) {
  const admin = role === "owner" || role === "admin";
  const [title, setTitle] = useState(""),
    [area, setArea] = useState("general"),
    [description, setDescription] = useState(""),
    [steps, setSteps] = useState(""),
    [expected, setExpected] = useState("");
  const [include, setInclude] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(""),
    [refresh, setRefresh] = useState(0);
  const retry = useRef({ signature: "", key: "" });
  const [diagnostics] = useState(() =>
    typeof window === "undefined"
      ? {}
      : {
          appVersion: APP_VERSION,
          platform: /android/i.test(navigator.userAgent) ? "android" : "web",
          browser: navigator.userAgent.slice(0, 350),
          viewport: `${window.innerWidth} × ${window.innerHeight}`,
        },
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setReceipt("");
    const body = {
      title,
      area,
      description,
      steps,
      expected,
      diagnostics: include ? diagnostics : {},
    };
    const signature = JSON.stringify(body);
    if (retry.current.signature !== signature)
      retry.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await accountRequest<{ id: string }>("reports", {
        ...body,
        requestKey: retry.current.key,
      });
      setReceipt(result.id);
      setTitle("");
      setDescription("");
      setSteps("");
      setExpected("");
      retry.current = { signature: "", key: "" };
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="bug-reports" className="portal-card bug-reports" aria-labelledby="bug-title">
      <p className="portal-eyebrow">HELP IMPROVE LOOTSPLIT</p>
      <h2 id="bug-title">Bug reports</h2>
      <p>
        Tell us what went wrong. Reports are private to you, the owner and administrators. Check
        here for responses; email notifications are not sent.
      </p>
      {!userId ? (
        <p>Sign in below to report a bug and track its progress.</p>
      ) : (
        <>
          <details>
            <summary>Report a bug</summary>
            <form className="owner-form bug-form" onSubmit={submit}>
              <p>
                Do not include passwords, recovery keys or campaign invite links. Up to five reports
                per 24 hours.
              </p>
              <label>
                Title
                <input
                  aria-label="Bug title"
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Area
                <select
                  aria-label="Bug area"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                >
                  {areas.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label>
                What went wrong?
                <textarea
                  aria-label="What went wrong?"
                  required
                  maxLength={4000}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                Steps to reproduce (optional)
                <textarea
                  aria-label="Steps to reproduce"
                  maxLength={4000}
                  rows={3}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                />
              </label>
              <label>
                Expected result (optional)
                <textarea
                  aria-label="Expected result"
                  maxLength={2000}
                  rows={2}
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                />
              </label>
              <label className="portal-check">
                <input
                  type="checkbox"
                  checked={include}
                  onChange={(e) => setInclude(e.target.checked)}
                />
                Include device details shown below
              </label>
              <details>
                <summary>Preview optional device details</summary>
                <dl>
                  {Object.entries(diagnostics).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p>No campaign content, files, credentials or browsing history are collected.</p>
              </details>
              <button className="portal-button" disabled={busy}>
                {busy ? "Submitting…" : "Submit bug report"}
              </button>
            </form>
          </details>
          {error && (
            <p role="alert" className="portal-message error">
              {error}
            </p>
          )}
          {receipt && (
            <p role="status" className="portal-message">
              Report received. Reference: {receipt}
            </p>
          )}
          <ReportInbox admin={admin} refresh={refresh} />
        </>
      )}
    </section>
  );
}
function ReportInbox({ admin, refresh }: { admin: boolean; refresh: number }) {
  const [scope, setScope] = useState("mine"),
    [status, setStatus] = useState("all"),
    [offset, setOffset] = useState(0),
    [reload, setReload] = useState(0);
  const [reports, setReports] = useState<Report[]>([]),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setReports([]);
    accountRequest<{ reports: Report[]; hasMore: boolean }>(
      `reports?scope=${scope}&status=${status}&offset=${offset}`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        setReports(data.reports);
        setMore(data.hasMore);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [scope, status, offset, reload, refresh]);
  return (
    <div className="bug-inbox">
      <h3>{scope === "all" ? "Administrator report inbox" : "Your reports"}</h3>
      <div className="portal-actions bug-filters">
        {admin && (
          <label>
            Inbox
            <select
              aria-label="Report inbox"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setOffset(0);
                setSelected(null);
              }}
            >
              <option value="mine">Your reports</option>
              <option value="all">All member reports</option>
            </select>
          </label>
        )}
        <label>
          Status
          <select
            aria-label="Filter reports by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          className="portal-button secondary"
          disabled={busy}
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh reports
        </button>
      </div>
      {error && (
        <p role="alert" className="portal-message error">
          {error}
        </p>
      )}
      {busy ? (
        <p role="status">Loading reports…</p>
      ) : !error && !reports.length ? (
        <p>No reports on this page.</p>
      ) : null}
      <ul className="bug-list">
        {reports.map((r) => (
          <li key={r.id}>
            <button onClick={() => setSelected(r.id)}>
              <strong>{r.title}</strong>
              <span>
                {r.status} · {r.priority} · {new Date(r.created_at).toLocaleDateString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="portal-actions">
        <button
          className="portal-button secondary"
          disabled={busy || offset === 0}
          onClick={() => setOffset((n) => Math.max(0, n - 20))}
        >
          Previous reports
        </button>
        <button
          className="portal-button secondary"
          disabled={busy || !!error || !more}
          onClick={() => setOffset((n) => n + 20)}
        >
          Next reports
        </button>
      </div>
      {selected && (
        <ReportDetail
          key={selected}
          id={selected}
          admin={admin}
          close={() => setSelected(null)}
          saved={() => setReload((n) => n + 1)}
        />
      )}
    </div>
  );
}
function ReportDetail({
  id,
  admin,
  close,
  saved,
}: {
  id: string;
  admin: boolean;
  close: () => void;
  saved: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null),
    [status, setStatus] = useState("new"),
    [priority, setPriority] = useState("normal"),
    [response, setResponse] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    accountRequest<Detail>("reports/detail", { id }, controller.signal)
      .then((d) => {
        setData(d);
        setStatus(d.status);
        setPriority(d.priority);
        setResponse(d.response);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [id, reload]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!data || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await accountRequest("reports/update", {
        id,
        status,
        priority,
        response,
        revision: data.revision,
      });
      setNotice("Report updated.");
      setReload((n) => n + 1);
      saved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bug-detail" aria-label="Report details">
      <div className="portal-actions">
        <button className="portal-button secondary" onClick={close}>
          Close report
        </button>
        <button
          className="portal-button secondary"
          disabled={busy}
          onClick={() => setReload((n) => n + 1)}
        >
          Reload report
        </button>
      </div>
      {error && (
        <p role="alert" className="portal-message error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data && !error ? <p>Loading report…</p> : null}
      {data && (
        <>
          <h3>{data.title}</h3>
          <p>Reference: {data.id}</p>
          <p>
            {data.area} · {data.status} · {data.priority}
          </p>
          <p>
            Submitted {new Date(data.created_at).toLocaleString()} · Updated{" "}
            {new Date(data.updated_at).toLocaleString()}
          </p>
          <h4>What went wrong</h4>
          <p className="bug-text">{data.description}</p>
          {data.steps && (
            <>
              <h4>Steps to reproduce</h4>
              <p className="bug-text">{data.steps}</p>
            </>
          )}
          {data.expected && (
            <>
              <h4>Expected result</h4>
              <p className="bug-text">{data.expected}</p>
            </>
          )}
          <details>
            <summary>Submitted device details</summary>
            {Object.keys(data.diagnostics).length ? (
              <dl>
                {Object.entries(data.diagnostics).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>No device details included.</p>
            )}
          </details>
          <h4>Response</h4>
          <p className="bug-text">{data.response || "No response yet."}</p>
          {admin && (
            <form className="owner-form bug-form" onSubmit={save}>
              <h4>Administrator triage</h4>
              <label>
                Status
                <select
                  aria-label="Report status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  aria-label="Report priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {["low", "normal", "high", "urgent"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Response visible to reporter
                <textarea
                  aria-label="Response to reporter"
                  maxLength={2000}
                  rows={3}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                />
              </label>
              <button className="portal-button" disabled={busy}>
                {busy ? "Saving…" : "Save report update"}
              </button>
            </form>
          )}
          {!!data.history.length && (
            <details>
              <summary>Recent update history</summary>
              <ul>
                {data.history.map((h, i) => (
                  <li key={i}>
                    <p>
                      {new Date(h.created_at).toLocaleString()} · {h.status} · {h.priority}
                    </p>
                    <p className="bug-text">{h.response || "No response provided."}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
