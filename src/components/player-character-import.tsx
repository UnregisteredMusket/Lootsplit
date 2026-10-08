import { useEffect, useRef, useState } from "react";
import { accountRequest } from "@/lib/account/client";
import { Link } from "@tanstack/react-router";
export function PlayerCharacterImport({ code }: { code: string }) {
  const [data, setData] = useState<{
    characters: { id: string; revision: number; campaign_code: string; body: { name: string } }[];
    campaigns: { code: string; purses: { id: string; name: string }[] }[];
  } | null>(null);
  const [requests, setRequests] = useState<
    { id: string; purse_id: string; status: string; body: { name: string } }[]
  >([]);
  const [character, setCharacter] = useState("");
  const [purse, setPurse] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    const c = new AbortController();
    async function load() {
      const session = await accountRequest<{ user?: unknown } | null>(
        "auth/get-session",
        undefined,
        c.signal,
      );
      if (!session?.user) return;
      const profile = await accountRequest<NonNullable<typeof data>>("sheets", undefined, c.signal);
      const imports = await accountRequest<{ requests: typeof requests }>(
        "sheets/imports",
        { code },
        c.signal,
      );
      if (!c.signal.aborted) {
        setData(profile);
        setRequests(imports.requests);
      }
    }
    void load().catch((e) => {
      if (!c.signal.aborted) setError(e.message);
    });
    return () => c.abort();
  }, [code, refresh]);
  if (!data && !error) return null;
  const choices = data?.characters.filter((c) => !c.campaign_code) || [];
  const targets = data?.campaigns.find((c) => c.code === code)?.purses || [];
  return (
    <details className="review-inbox">
      <summary>Import an account character · DM approval required</summary>
      <p>
        Submit a saved account sheet for your assigned campaign character. Your DM reviews it before
        it changes the campaign. Existing campaign money and items are preserved.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const selected = choices.find((c) => c.id === character);
          if (!selected) return;
          setBusy(true);
          setError("");
          try {
            await accountRequest("sheets/assign", {
              id: selected.id,
              revision: selected.revision,
              code,
              purseId: purse,
              requestKey: key.current,
            });
            key.current = crypto.randomUUID();
            setNotice("Import submitted for DM review.");
            setRefresh((n) => n + 1);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Import failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Saved account character
          <select value={character} onChange={(e) => setCharacter(e.target.value)}>
            <option value="">Choose saved sheet</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.body.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned campaign character
          <select value={purse} onChange={(e) => setPurse(e.target.value)}>
            <option value="">Choose campaign character</option>
            {targets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || !character || !purse}>Submit character for review</button>
      </form>
      {!choices.length && (
        <p>
          <Link to="/characters">Create or import a saved account character</Link> first.
        </p>
      )}
      <button disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
        Refresh import status
      </button>
      {requests.map((r) => (
        <p key={r.id}>
          {r.body.name} → {targets.find((target) => target.id === r.purse_id)?.name || r.purse_id}:{" "}
          {r.status}. Campaign money and inventory are preserved.
        </p>
      ))}
    </details>
  );
}
