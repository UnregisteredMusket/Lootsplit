import { useState, useEffect } from "react";
import { z } from "zod";
import { sheetSchema } from "@/lib/characters/model.mjs";
import { accountRequest } from "@/lib/account/client";
import { compareImportedSheet } from "@/lib/quire/sheet-import-comparison";
import "./characters/character-improvements.css";
import { announceSheetChange } from "@/lib/quire/party-sheet-links";
type Sheet = z.infer<typeof sheetSchema>;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Unable to review import.");
export function CharacterImportReviews({ code }: { code: string }) {
  const [requests, setRequests] = useState<
    { id: string; purse_id: string; target_revision?: number; body: Sheet; status: string }[]
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<Record<string, { body: Sheet; revision: number }>>({});
  const [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRequests([]);
    setTargets({});
    setTargetErrors({});
    setError("");
    setLoading(true);
    void accountRequest<{ requests: typeof requests }>(
      "sheets/imports",
      { code },
      controller.signal,
    )
      .then(async (r) => {
        const ids = [
          ...new Set(
            r.requests
              .filter((request) => request.status === "pending")
              .map((request) => request.purse_id),
          ),
        ];
        const results = await Promise.allSettled(
          ids.map((purseId) =>
            accountRequest<{ body: Sheet; revision: number }>(
              "sheets/detail",
              { id: `campaign:${code}:${purseId}` },
              controller.signal,
            ),
          ),
        );
        if (controller.signal.aborted) return;
        const next: typeof targets = {},
          failures: Record<string, string> = {};
        results.forEach((result, index) => {
          if (result.status === "fulfilled") next[ids[index]] = result.value;
          else failures[ids[index]] = errorText(result.reason);
        });
        setRequests(r.requests);
        setTargets(next);
        setTargetErrors(failures);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [code, refresh]);
  async function review(id: string, decision: string) {
    setBusy(true);
    setError("");
    try {
      await accountRequest("sheets/review-import", { id, decision });
      setRefresh((n) => n + 1);
      announceSheetChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sheet-card">
      <h3>Character import requests</h3>
      <p>
        Review the submitted sheet before approving. Existing campaign money and items are
        preserved. Later character edits still follow campaign permissions.
      </p>
      <button disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
        Refresh import requests
      </button>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading import requests and current campaign characters…</p>}
      {!loading && !error && requests.filter((r) => r.status === "pending").length === 0 && (
        <p>No pending character imports.</p>
      )}
      {requests
        .filter((r) => r.status === "pending")
        .map((r) => {
          const target = targets[r.purse_id],
            stale =
              !!target && r.target_revision !== undefined && target.revision !== r.target_revision;
          const groups = target ? compareImportedSheet(target.body, r.body) : [];
          return (
            <details key={r.id} className="character-import-comparison">
              <summary>
                Import {r.body.name} into {target?.body.name || r.purse_id} · awaiting approval
              </summary>
              <p>
                Campaign target: {target?.body.name || r.purse_id}. Campaign money and inventory
                remain unchanged; submitted account assets are excluded from approval.
              </p>
              {targetErrors[r.purse_id] && (
                <p role="alert">
                  Current target unavailable: {targetErrors[r.purse_id]} Refresh before approving.
                </p>
              )}
              {stale && (
                <p role="alert">
                  This character changed since submission. Deny this request and ask for a fresh
                  import; the server will not apply an outdated request.
                </p>
              )}
              {target && (
                <section aria-label={`Changes proposed for ${target.body.name}`}>
                  <h4>Current campaign sheet → proposed import</h4>
                  {target.body.portrait !== r.body.portrait &&
                    (target.body.portrait || r.body.portrait) && (
                      <div className="import-portrait-comparison">
                        <div>
                          <strong>Current portrait</strong>
                          {target.body.portrait ? (
                            <img
                              className="import-portrait"
                              src={target.body.portrait}
                              alt={`Current portrait for ${target.body.name}`}
                            />
                          ) : (
                            <p>No current portrait.</p>
                          )}
                        </div>
                        <div>
                          <strong>Proposed portrait</strong>
                          {r.body.portrait ? (
                            <img
                              className="import-portrait"
                              src={r.body.portrait}
                              alt={`Proposed portrait for ${r.body.name}`}
                            />
                          ) : (
                            <p>Portrait removed.</p>
                          )}
                        </div>
                      </div>
                    )}

                  {!groups.length && (
                    <p>
                      No stat or identity changes. The full submitted sheet remains available below.
                    </p>
                  )}
                  {groups.map((group) => (
                    <details key={group.name} open>
                      <summary>
                        {group.name} · {group.changes.length} changes
                      </summary>
                      <table>
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>Current</th>
                            <th>Proposed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.changes.map((row) => (
                            <tr key={row.field}>
                              <th scope="row">{row.field}</th>
                              <td>
                                <pre>{row.before}</pre>
                              </td>
                              <td>
                                <pre>{row.after}</pre>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  ))}
                </section>
              )}
              <p>
                {r.body.classes} · Level {r.body.level} · HP {r.body.hp}/{r.body.maxHp} · AC{" "}
                {r.body.ac}
              </p>
              <p>
                {Object.entries(r.body.scores)
                  .map(([k, v]) => `${k.toUpperCase()} ${v}`)
                  .join(" · ")}
              </p>
              <details>
                <summary>Full submitted sheet</summary>
                {r.body.portrait ? (
                  <img
                    className="import-portrait"
                    src={r.body.portrait}
                    alt={`Submitted portrait for ${r.body.name}`}
                  />
                ) : (
                  <p>No submitted portrait.</p>
                )}
                <SubmittedFields value={r.body} />
              </details>
              <button
                disabled={busy || !target || stale}
                onClick={() => void review(r.id, "approved")}
              >
                Approve {r.body.name}
              </button>
              <button disabled={busy} onClick={() => void review(r.id, "denied")}>
                Deny {r.body.name}
              </button>
            </details>
          );
        })}
    </section>
  );
}

function SubmittedFields({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span>—</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <SubmittedFields value={v} />
          </li>
        ))}
      </ul>
    );
  return (
    <dl>
      {Object.entries(value)
        .filter(([k]) => k !== "portrait")
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt>
            <dd>
              <SubmittedFields value={v} />
            </dd>
          </div>
        ))}
    </dl>
  );
}
