import { useState, useEffect } from "react";
import { z } from "zod";
import { sheetSchema } from "@/lib/characters/model.mjs";
import { accountRequest } from "@/lib/account/client";
import { announceSheetChange } from "@/lib/quire/party-sheet-links";
type Sheet = z.infer<typeof sheetSchema>;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Unable to review import.");
export function CharacterImportReviews({ code }: { code: string }) {
  const [requests, setRequests] = useState<
    { id: string; purse_id: string; body: Sheet; status: string }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRequests([]);
    accountRequest<{ requests: typeof requests }>("sheets/imports", { code }, controller.signal)
      .then((r) => setRequests(r.requests))
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
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
      {requests.filter((r) => r.status === "pending").length === 0 && (
        <p>No pending character imports.</p>
      )}
      {requests
        .filter((r) => r.status === "pending")
        .map((r) => (
          <details key={r.id}>
            <summary>{r.body.name} · awaiting approval</summary>
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
              <SubmittedFields value={r.body} />
            </details>
            <button disabled={busy} onClick={() => void review(r.id, "approved")}>
              Approve {r.body.name}
            </button>
            <button disabled={busy} onClick={() => void review(r.id, "denied")}>
              Deny {r.body.name}
            </button>
          </details>
        ))}
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
