import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { FeatureCards } from "./feature-navigation";
import { downloadJson } from "@/lib/quire/table";

import { useDisclosureAnchor } from "@/lib/help/use-disclosure-anchor";

import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import type { Journal } from "@/lib/quire/journal";
import {
  readArchiveResult,
  readSessionSummary,
  type ArchiveResult,
  type ArchiveSeat,
} from "@/lib/quire/archive-reader";
import { formatCopper } from "@/lib/quire/money";
import { Button, Fold, Modal } from "./ui";
import { SessionReportReader } from "./session-report-reader";
import { CoinAmountInput, FinanceReadiness } from "./finance-input";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import { useArchiveReaderSeat } from "@/lib/quire/use-archive-reader-seat";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { journalEntryHref, sessionChronicleEntries } from "@/lib/quire/journal-navigation";
import { AppLink } from "./app-link";
import { readFinance } from "@/lib/quire/finance";
import {
  debtForLoanRequest,
  loanRecordId,
  loanRequestRecordId,
} from "@/lib/quire/finance-record-links";
import { activeDatabaseName } from "@/lib/quire/db";
import {
  rememberSessionName,
  takeSessionName,
  peekSessionName,
  forgetSessionName,
} from "@/lib/quire/session-name-draft";
function RecordedChange({ change }: { change: NonNullable<Journal["events"][number]["change"]> }) {
  const keys = [
    ...new Set([...Object.keys(change.before || {}), ...Object.keys(change.after || {})]),
  ].filter((key) => change.before?.[key] !== change.after?.[key]);
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer">Recorded changes</summary>
      <dl className="mt-2 grid gap-2">
        {keys.map((key) => (
          <div key={key} className="break-words">
            <dt className="font-medium">{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt>
            <dd>
              {String(change.before?.[key] ?? "Not recorded")} →{" "}
              {String(change.after?.[key] ?? "Not recorded")}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
function ArchivedReportDownload({
  report,
  result,
  seat,
}: {
  report: NonNullable<Journal["reports"]>[number];
  result: ArchiveResult;
  seat: ArchiveSeat;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="journal-entry">
      <strong>{report.name}</strong>
      <small>{new Date(report.at).toLocaleString()}</small>
      {!result.available && <p role="alert">{result.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Read session report
        </Button>
        <Button
          variant="secondary"
          disabled={!result.available}
          onClick={() => {
            if (result.available)
              void downloadJson("lootsplit-session-" + report.id + ".json", result.snapshot);
          }}
        >
          Download session report
        </Button>
      </div>
      {open && <SessionReportReader report={report} seat={seat} open onOpenChange={setOpen} />}
    </div>
  );
}
export function CampaignJournal({
  section = "overview",
  reviewOnly = false,
}: {
  section?: "overview" | "sessions" | "bank" | "reports";
  reviewOnly?: boolean;
}) {
  const navigate = useNavigate();
  const reviewRef = useDisclosureAnchor("review-inbox");
  const { journal, ledger, purses, command, commandOutcome, loans, decideLoan } = useEconomy();
  const seat = useSeat();
  const archiveSeat = useArchiveReaderSeat(seat);
  const dm = seat.role === "dm";
  const readiness = useFinanceReadiness();
  const draftScope = JSON.stringify([
    activeDatabaseName(),
    readiness.room.code,
    typeof window === "undefined"
      ? ""
      : window.sessionStorage.getItem("lootsplit.verified-account") || "guest",
  ]);
  const sessionsVisible = section === "overview" || section === "sessions";
  const [sessionDraft, setSessionDraft] = useState(() => ({
    scope: draftScope,
    name: sessionsVisible ? peekSessionName(draftScope) : "",
  }));
  const name = sessionDraft.scope === draftScope ? sessionDraft.name : "";
  const setName = (next: string) => setSessionDraft({ scope: draftScope, name: next });
  const [financeHandoff, setFinanceHandoff] = useState(false);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [days, setDays] = useState(journal.downtimePrompt?.days ?? 0);
  const [note, setNote] = useState("");
  const [copper, setCopper] = useState("");
  const [purseId, setPurse] = useState("");
  const [busy, setBusy] = useState(false);
  useDraftGuard(
    (!!name && !financeHandoff) || !!note || !!copper,
    note || copper ? "payment request" : "session name",
  );
  useEffect(() => {
    const transferredName = sessionsVisible ? takeSessionName(draftScope) : "";
    setSessionDraft((current) =>
      transferredName || current.scope !== draftScope
        ? { scope: draftScope, name: transferredName }
        : current,
    );
  }, [draftScope, sessionsVisible]);
  useEffect(() => {
    if (!financeHandoff) return;
    let mounted = true;
    void navigate({
      to: "/features/$feature",
      params: { feature: "downtime" },
      search: { from: "/?view=overview", code: undefined },
    })
      .catch(() =>
        toast.error("Could not open downtime calculations. Your session name is still here."),
      )
      .finally(() => {
        if (mounted) {
          forgetSessionName(draftScope);
          setFinanceHandoff(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [financeHandoff, draftScope, navigate]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [reportSearch, setReportSearch] = useState("");
  const [reportFilter, setReportFilter] = useState("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [activityFilter, setActivityFilter] = useState("all");
  const [requestSearch, setRequestSearch] = useState("");
  const [requestStatus, setRequestStatus] = useState("all");
  const [requestKind, setRequestKind] = useState("all");
  const [openedReportId, setOpenedReportId] = useState("");
  const openedReport = journal.reports?.find((report) => report.id === openedReportId);
  const downtime = journal.finance?.downtime.find((d) => d.status === "pending");
  const [approveDowntime, setApproveDowntime] = useState("");
  const active = journal.sessions.find((x) => !x.endedAt);
  const accounts = dm ? purses : purses.filter((x) => seat.purseIds.includes(x.id));
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  async function saveSession(end = false) {
    const outcome = await commandOutcome({
      kind: "session",
      name: end ? active!.name : name,
      end,
      ...(!end && downtime && approveDowntime === downtime.id ? { downtimeId: downtime.id } : {}),
    });
    if (!end) {
      forgetSessionName(draftScope);
      setName("");
    }
    toast.success(
      mutationNotice(
        outcome,
        end ? "Recorded session ended. Room access is unchanged." : "Session record saved.",
      ),
    );
  }
  const requests = journal.requests.filter((x) => dm || seat.purseIds.includes(x.purseId));
  const loanRequests = loans.filter((x) => dm || seat.purseIds.includes(x.purseId));
  const hash = useRouterState({ select: (state) => state.location.hash });
  const linkedLoanRequestId = loanRequests.find(
    (request) => loanRequestRecordId(request.id) === hash,
  )?.id;
  useEffect(() => {
    if (!linkedLoanRequestId) return;
    setRequestSearch("");
    setRequestStatus("all");
    setRequestKind("all");
    if (reviewRef.current) reviewRef.current.open = true;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(loanRequestRecordId(linkedLoanRequestId))
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [linkedLoanRequestId, hash, reviewRef]);
  const pending = loanRequests.filter((x) => x.status === "pending");
  const matchesRequest = (request: { status: string; note: string; purseId: string }) =>
    (requestStatus === "all" ||
      (requestStatus === "pending"
        ? request.status === "pending"
        : request.status !== "pending")) &&
    (!requestSearch.trim() ||
      `${request.note} ${purses.find((p) => p.id === request.purseId)?.name ?? ""} ${request.status}`
        .toLowerCase()
        .includes(requestSearch.trim().toLowerCase()));
  const shownLoanRequests = requestKind === "payments" ? [] : loanRequests.filter(matchesRequest);
  const shownRequests = requestKind === "loans" ? [] : requests.filter(matchesRequest);
  const events = [
    ...ledger
      .filter((x) => dm || seat.purseIds.includes(x.purseId))
      .map((x) => ({ ...x, kind: "transaction" })),
    ...journal.events.filter((x) => dm || !x.purseId || seat.purseIds.includes(x.purseId)),
  ].sort((a, b) => b.at - a.at);
  const reports = useMemo(
    () =>
      (journal.reports || []).map((report) => ({
        report,
        result: readArchiveResult(report, archiveSeat),
      })),
    [journal.reports, archiveSeat],
  );
  const shownReports = reports.filter(
    ({ report, result }) =>
      (!reportSearch.trim() ||
        `${report.name} ${new Date(report.at).toLocaleString()}`
          .toLowerCase()
          .includes(reportSearch.trim().toLowerCase())) &&
      (reportFilter === "all" ||
        (reportFilter === "readable" ? result.available : !result.available)),
  );
  const sessionRecords = useMemo(
    () =>
      [...journal.sessions].reverse().map((session) => {
        const archived = journal.reports?.find((report) => report.id === session.id);
        return {
          session,
          archived,
          result: readSessionSummary(session, ledger, archived, archiveSeat),
        };
      }),
    [journal.sessions, journal.reports, ledger, archiveSeat],
  );
  const shownSessions = sessionRecords.filter(
    ({ session }) =>
      (!sessionSearch.trim() ||
        `${session.name} ${new Date(session.startedAt).toLocaleString()}`
          .toLowerCase()
          .includes(sessionSearch.trim().toLowerCase())) &&
      (sessionFilter === "all" ||
        (sessionFilter === "ended" ? !!session.endedAt : !session.endedAt)),
  );
  const shownEvents = events.filter(
    (event) =>
      (activityFilter === "all" || event.kind === activityFilter) &&
      (!activitySearch.trim() ||
        `${event.summary} ${new Date(event.at).toLocaleString()}`
          .toLowerCase()
          .includes(activitySearch.trim().toLowerCase())),
  );
  return (
    <div className="campaign-journal" id="review">
      {(section === "overview" || section === "sessions") && (
        <>
          <Fold
            anchorId="sessions"
            title={active ? `Session · ${active.name}` : "Play sessions"}
            hint="Named sessions, with recorded coin movement."
          >
            {dm ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!downtime && journal.downtimePrompt?.enabled !== false) {
                    setDowntimeOpen(true);
                    return;
                  }
                  void run(() => saveSession());
                }}
                className="flex flex-wrap gap-2"
              >
                <input
                  className="ledger-search flex-1"
                  aria-label="Session name"
                  placeholder="Name your next session"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {downtime && (
                  <label className="text-sm">
                    <input
                      type="checkbox"
                      checked={approveDowntime === downtime.id}
                      onChange={(e) => setApproveDowntime(e.target.checked ? downtime.id : "")}
                    />{" "}
                    I approve the downtime plan.{" "}
                    <a href="#campaign-finance">Review downtime calculations</a>.
                  </label>
                )}
                <Button
                  disabled={busy || (!!downtime && approveDowntime !== downtime.id)}
                  type="submit"
                >
                  {downtime
                    ? "Approve downtime & start session"
                    : active
                      ? "End & start next"
                      : "Start session"}
                </Button>
                {active ? (
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() => void run(() => saveSession(true))}
                  >
                    End recorded session
                  </Button>
                ) : null}
              </form>
            ) : null}
            {!journal.sessions.length ? (
              <p className="text-muted">
                No sessions recorded yet. Earlier activity remains in the ledger.
              </p>
            ) : null}
            {journal.sessions.length > 0 && (
              <div className="flex flex-wrap gap-2 my-3">
                <input
                  className="ledger-search"
                  aria-label="Search recorded sessions"
                  placeholder="Search sessions or dates"
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                />
                <select
                  className="ledger-search"
                  aria-label="Session state"
                  value={sessionFilter}
                  onChange={(e) => setSessionFilter(e.target.value)}
                >
                  <option value="all">All sessions</option>
                  <option value="active">In progress</option>
                  <option value="ended">Ended records</option>
                </select>
                <p className="text-sm text-muted">
                  {shownSessions.length} of {journal.sessions.length} session records
                </p>
              </div>
            )}
            {shownSessions.map(({ session, archived, result }) => {
              return (
                <div className="journal-entry" key={session.id}>
                  <strong>{session.name}</strong>
                  <small>
                    {new Date(session.startedAt).toLocaleString()} ·{" "}
                    {session.endedAt ? "Ended" : "In progress"}
                  </small>
                  {result.available ? (
                    <p>
                      Received {formatCopper(result.summary.received)} · Spent{" "}
                      {formatCopper(result.summary.spent)} · Net {formatCopper(result.summary.net)}
                    </p>
                  ) : (
                    <p role="alert">{result.error}</p>
                  )}
                  {archived && (
                    <Button variant="secondary" onClick={() => setOpenedReportId(archived.id)}>
                      Read session report
                    </Button>
                  )}
                  {sessionChronicleEntries(journal.entries || [], seat, session.id).map((entry) => (
                    <AppLink
                      className="settings-link"
                      key={entry.id}
                      href={journalEntryHref(entry.id)}
                    >
                      Read linked journal entry · {entry.title}
                    </AppLink>
                  ))}
                </div>
              );
            })}
            {!!journal.sessions.length && !shownSessions.length && (
              <p>No sessions match. Clear the search or choose All sessions.</p>
            )}
            <p className="text-sm text-muted">
              Received/spent excludes internal coin transfers. Net is the balance movement; this is
              not a measure of newly earned wealth or changes in item valuations.
            </p>
          </Fold>
          <Modal
            open={downtimeOpen}
            onOpenChange={setDowntimeOpen}
            title="Set downtime before this session"
          >
            <p>
              How many in-game days passed? Choose 0 to continue without downtime and turn off
              future reminders. You can change this in Campaign finances & downtime.
            </p>
            <label>
              Downtime days
              <input
                className="ledger-search"
                aria-label="Downtime days"
                type="number"
                min={0}
                max={3650}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <Button
              disabled={busy || !Number.isSafeInteger(days) || days < 0 || days > 3650}
              onClick={() =>
                void run(async () => {
                  if (days === 0) {
                    await command({ kind: "downtime-preference", days: 0 });
                    await saveSession();
                  } else {
                    await command({ kind: "downtime-plan", name: "Before " + name, days, advanceSeason: !!journal.tradeEconomy?.settings.enabled });
                  }
                  setDowntimeOpen(false);
                  if (days > 0) {
                    const finance = document.getElementById(
                      "campaign-finance",
                    ) as HTMLDetailsElement | null;
                    if (finance) {
                      finance.open = true;
                      finance.scrollIntoView();
                    } else {
                      rememberSessionName(draftScope, name);
                      setFinanceHandoff(true);
                    }
                  }
                })
              }
            >
              {days === 0 ? "Use 0 days & start session" : "Preview downtime calculations"}
            </Button>
          </Modal>
        </>
      )}
      {section === "overview" && <FeatureCards />}
      {section === "reports" && (
        <>
          <Fold title="Character edit reports" hint="Before and after each DM editing window.">
            {(journal.editReports || [])
              .filter((r) => dm || seat.purseIds.includes(r.purseId))
              .map((r) => (
                <details className="journal-entry" key={r.id}>
                  <summary>
                    {r.name} · {new Date(r.at).toLocaleString()}
                  </summary>
                  {Object.keys(r.after)
                    .filter(
                      (key) =>
                        JSON.stringify(r.before[key as keyof typeof r.before]) !==
                        JSON.stringify(r.after[key as keyof typeof r.after]),
                    )
                    .map((key) => (
                      <p key={key} className="break-words">
                        <strong>{key}</strong>:{" "}
                        {JSON.stringify(r.before[key as keyof typeof r.before])} →{" "}
                        {JSON.stringify(r.after[key as keyof typeof r.after])}
                      </p>
                    ))}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void downloadJson("lootsplit-character-edits-" + r.id + ".json", r)
                    }
                  >
                    Download changes
                  </Button>
                </details>
              ))}
          </Fold>
          <Fold title="Archived session reports" hint="Recorded before active logs are cleared.">
            <div className="flex flex-wrap gap-2">
              <input
                className="ledger-search"
                aria-label="Search archived session reports"
                placeholder="Search reports or dates"
                value={reportSearch}
                onChange={(e) => setReportSearch(e.target.value)}
              />
              <select
                className="ledger-search"
                aria-label="Report availability"
                value={reportFilter}
                onChange={(e) => setReportFilter(e.target.value)}
              >
                <option value="all">All reports</option>
                <option value="readable">Readable</option>
                <option value="recovery">Needs recovery</option>
              </select>
            </div>
            <p className="text-sm text-muted">
              {shownReports.length} of {reports.length} reports. Filters do not remove saved
              records.
            </p>
            {shownReports.map(({ report, result }) => (
              <ArchivedReportDownload
                key={report.id}
                report={report}
                result={result}
                seat={archiveSeat}
              />
            ))}
            {!reports.length ? (
              <p>No archived session reports yet.</p>
            ) : !shownReports.length ? (
              <p>No reports match. Clear the search or choose All reports.</p>
            ) : null}
          </Fold>
        </>
      )}
      {section === "bank" && (
        <details open ref={reviewRef} id="review-inbox" className="review-inbox">
          <summary>
            {dm ? "Payments & loans awaiting approval" : "My payment and loan requests"} ·{" "}
            {pending.length + requests.filter((x) => x.status === "pending").length} pending
          </summary>
          <p className="text-sm text-muted">
            {dm
              ? "Review character spending requests and loan applications. Approving a payment deducts the requested coins from that character’s account; approving a loan credits their account."
              : "Ask the DM to approve spending from your character’s account. Coins are deducted when the DM approves your payment. Your loan applications and their original decisions remain in this history."}{" "}
            Permitted shop purchases use Buy in the Market.
          </p>
          <FinanceReadiness />
          <div className="flex flex-wrap gap-2 my-3">
            <input
              className="ledger-search"
              aria-label="Search financial requests"
              placeholder="Find a request, account or decision"
              value={requestSearch}
              onChange={(event) => setRequestSearch(event.target.value)}
            />
            <select
              className="ledger-search"
              aria-label="Financial request status"
              value={requestStatus}
              onChange={(event) => setRequestStatus(event.target.value)}
            >
              <option value="all">All request history</option>
              <option value="pending">Pending DM review</option>
              <option value="decided">Decided requests</option>
            </select>
            <select
              className="ledger-search"
              aria-label="Financial request type"
              value={requestKind}
              onChange={(event) => setRequestKind(event.target.value)}
            >
              <option value="all">Loans and payments</option>
              <option value="loans">Loan applications</option>
              <option value="payments">Payment requests</option>
            </select>
            <Button
              variant="secondary"
              onClick={() => {
                setRequestSearch("");
                setRequestStatus("all");
                setRequestKind("all");
              }}
            >
              Clear request filters
            </Button>
          </div>
          <p className="text-sm text-muted">
            {shownLoanRequests.length + shownRequests.length} of{" "}
            {loanRequests.length + requests.length} requests shown.{" "}
            {pending.length + requests.filter((request) => request.status === "pending").length}{" "}
            still need DM review; filters do not change their status.
          </p>
          {dm && !pending.length && !requests.some((x) => x.status === "pending") && (
            <p role="status">No payments or loans need approval.</p>
          )}
          {shownLoanRequests.map((x) => {
            const debt = debtForLoanRequest(x, readFinance(journal.finance).loans);
            return (
              <div
                className="journal-entry"
                key={x.id}
                id={loanRequestRecordId(x.id)}
                style={{ scrollMarginTop: "6rem" }}
              >
                <strong>
                  Loan · {x.purseName} · {formatCopper(x.copper)}
                </strong>
                <p>{x.note}</p>
                <small>{x.status}</small>
                {x.status === "approved" &&
                  (debt ? (
                    <AppLink
                      className="settings-link"
                      href={`/features/bank#${loanRecordId(debt.id)}`}
                    >
                      View resulting loan record
                    </AppLink>
                  ) : (
                    <p className="text-sm text-muted">
                      The original loan record link is unavailable. Your authorized Bank history
                      remains available.
                    </p>
                  ))}
                {dm && x.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button
                      disabled={busy}
                      onClick={() => void run(() => decideLoan(x.id, "approved"))}
                    >
                      Approve loan
                    </Button>
                    <Button
                      disabled={busy}
                      variant="secondary"
                      onClick={() => void run(() => decideLoan(x.id, "denied"))}
                    >
                      Decline
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {[...shownRequests].reverse().map((x) => (
            <div className="journal-entry" key={x.id}>
              <strong>
                Payment · {purses.find((p) => p.id === x.purseId)?.name} · {formatCopper(x.copper)}
              </strong>
              <p>{x.note}</p>
              <small>{x.status}</small>
              {x.status === "approved" && (
                <p className="text-sm text-muted">
                  No original transaction link was stored for this request.{" "}
                  <AppLink href={dm ? "/features/reports" : "/features/finances"}>
                    Open authorized financial history
                  </AppLink>
                </p>
              )}
              {dm && x.status === "pending" ? (
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        command({
                          kind: "payment-decision",
                          requestId: x.id,
                          status: "approved",
                        }),
                      )
                    }
                  >
                    Approve payment
                  </Button>
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() =>
                      void run(() =>
                        command({
                          kind: "payment-decision",
                          requestId: x.id,
                          status: "denied",
                        }),
                      )
                    }
                  >
                    Decline
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {!shownLoanRequests.length && !shownRequests.length && (
            <p>No requests match. Clear request filters to see the complete authorized history.</p>
          )}
          {(!dm || !reviewOnly) && (
            <form
              className="mt-4 grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const outcome = await commandOutcome({
                    kind: "payment-request",
                    purseId: purseId || accounts[0]?.id || "",
                    copper: Number(copper),
                    note,
                  });
                  setNote("");
                  setCopper("");
                  toast.success(mutationNotice(outcome, "Payment request recorded for DM review."));
                });
              }}
            >
              <h3>
                {dm ? "Queue a character payment for approval" : "Request approval to spend coins"}
              </h3>
              <p className="text-sm text-muted">
                {dm
                  ? "Record a proposed expense from the selected character or party account, then approve or decline it in Review Inbox. This queues an expense; it does not send a payment demand to a player."
                  : "Enter an expense such as an inn bill or service. Approval spends these coins once. Use the Market to buy shop items."}
              </p>
              <select
                className="ledger-search"
                aria-label="Payment account"
                value={purseId || accounts[0]?.id || ""}
                onChange={(e) => setPurse(e.target.value)}
              >
                {accounts.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <CoinAmountInput
                label="Payment amount in copper"
                min={1}
                value={copper}
                onChange={setCopper}
                disabled={busy || readiness.locked}
              />
              <input
                className="ledger-search"
                aria-label="Payment description"
                required
                maxLength={1000}
                placeholder="What is this payment for?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button disabled={busy || !accounts.length || readiness.locked} type="submit">
                {dm ? "Queue payment" : "Submit request"}
              </Button>
            </form>
          )}
        </details>
      )}
      {section === "reports" && (
        <Fold
          title="Full activity"
          hint="Transactions and management events recorded by this version."
        >
          <div className="flex flex-wrap gap-2">
            <input
              className="ledger-search"
              aria-label="Search full activity"
              placeholder="Search recorded activity"
              value={activitySearch}
              onChange={(e) => setActivitySearch(e.target.value)}
            />
            <select
              className="ledger-search"
              aria-label="Activity kind"
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
            >
              <option value="all">All activity</option>
              {[...new Set(events.map((e) => e.kind))].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted">
            {shownEvents.length} of {events.length} records
          </p>
          {shownEvents.map((x, i) => (
            <div className="journal-entry" key={`${x.id}-${i}`}>
              <p>{x.summary}</p>
              {dm && "change" in x && x.change ? <RecordedChange change={x.change} /> : null}
              <small>
                {new Date(x.at).toLocaleString()} · {x.kind}
                {"copper" in x ? ` · ${formatCopper(x.copper)}` : ""}
              </small>
            </div>
          ))}
          {!events.length ? <p>No activity recorded.</p> : null}
          {!!events.length && !shownEvents.length && (
            <p>No activity matches. Clear the search or choose All activity.</p>
          )}
        </Fold>
      )}
      {openedReport && (
        <SessionReportReader
          report={openedReport}
          seat={archiveSeat}
          open
          onOpenChange={(open) => {
            if (!open) setOpenedReportId("");
          }}
        />
      )}
    </div>
  );
}
export function PriceHistory() {
  const dm = useSeat().role === "dm";
  const { journal } = useEconomy();
  return (
    <Fold
      title="Price-change history"
      hint="Recorded changes only; earlier prices are not reconstructed."
    >
      {journal.events
        .filter((x) => x.kind === "prices")
        .slice()
        .reverse()
        .map((x, i) => (
          <div className="journal-entry" key={`${x.id}-${i}`}>
            <p>{x.summary}</p>
            {dm && x.change ? <RecordedChange change={x.change} /> : null}
            <small>{new Date(x.at).toLocaleString()}</small>
          </div>
        ))}
    </Fold>
  );
}
