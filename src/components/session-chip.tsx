import { useSyncExternalStore } from "react";
import { AppLink } from "@/components/app-link";
import { Modal } from "@/components/ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { formatCopper } from "@/lib/quire/money";
import { useReviewCount } from "@/lib/quire/use-review-count";
import { useSeat } from "@/lib/quire/seat";
import {
  sessionChipLabel,
  sessionDigest,
  sessionStatus,
  type SessionDigest,
} from "@/lib/quire/session-digest";
import "./session-chip.css";

let sheetOpen = false;
const listeners = new Set<() => void>();
const setSheetOpen = (open: boolean) => {
  sheetOpen = open;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
/** Opens the session sheet (the header chip, or Settings & Management on phones). */
export const openSessionSheet = () => setSheetOpen(true);

/** "Session 12 · day 42" for the DM, wherever the session sheet can be opened. */
export function useSessionChipLabel() {
  const { journal } = useEconomy();
  return sessionChipLabel(sessionStatus(journal));
}

/** The DM's header chip (design D5); hidden on phones, where Settings & Management carries it. */
export function SessionChip() {
  const dm = useSeat().role === "dm";
  const label = useSessionChipLabel();
  if (!dm) return null;
  return (
    <button
      type="button"
      className="session-chip"
      aria-haspopup="dialog"
      aria-label={`${label}. Session controls`}
      onClick={openSessionSheet}
    >
      {label}
    </button>
  );
}

/** "Since last session" lines, shared by the session sheet and the Desk (design Q7). */
export function DigestLines({
  digest,
  pending,
  onNavigate,
}: {
  digest: SessionDigest;
  pending: number;
  onNavigate?: () => void;
}) {
  return (
    <ul className="session-digest-lines">
      <li>
        <span>Loot awarded</span>
        <strong>
          {digest.lootAwards
            ? `${digest.lootAwards} ${digest.lootAwards === 1 ? "award" : "awards"} · ${formatCopper(digest.lootCopper)}`
            : "None"}
        </strong>
      </li>
      <li>
        <span>Money in</span>
        <strong className={digest.moneyIn ? "text-positive" : undefined}>
          {digest.moneyIn ? `+${formatCopper(digest.moneyIn)}` : "None"}
        </strong>
      </li>
      <li>
        <span>Money out</span>
        <strong className={digest.moneyOut ? "text-negative" : undefined}>
          {digest.moneyOut ? `−${formatCopper(digest.moneyOut)}` : "None"}
        </strong>
      </li>
      <li>
        <span>Waiting for review</span>
        <strong>
          {pending ? (
            <AppLink href="/features/review" onClick={onNavigate}>
              {pending} in Review Inbox →
            </AppLink>
          ) : (
            "All caught up"
          )}
        </strong>
      </li>
      <li>
        <span>Characters away</span>
        <strong>
          {digest.away.length ? digest.away.join(", ") : "Everyone is with the party"}
        </strong>
      </li>
    </ul>
  );
}

function useDigest() {
  const { journal, ledger, purses } = useEconomy();
  return sessionDigest({ journal, ledger, purses });
}

/** Desk: what happened since the last session ended (design Q7). Hidden before the first one ends. */
export function DeskSinceLastSession() {
  const digest = useDigest();
  const pending = useReviewCount(true);
  if (digest.since === null) return null;
  return (
    <section id="since-last-session" className="desk-since" aria-labelledby="desk-since-heading">
      <h2 id="desk-since-heading">Since last session</h2>
      <small>
        Since {digest.sinceName} ended · {new Date(digest.since).toLocaleString()}
      </small>
      <DigestLines digest={digest} pending={pending} />
    </section>
  );
}

/** The session sheet, mounted once for the app; the chip and Settings open it. */
export function SessionSheetHost() {
  const open = useSyncExternalStore(
    subscribe,
    () => sheetOpen,
    () => false,
  );
  const dm = useSeat().role === "dm";
  if (!dm) return null;
  return open ? <SessionSheet /> : null;
}

function SessionSheet() {
  const { journal } = useEconomy();
  const status = sessionStatus(journal);
  const digest = useDigest();
  const pending = useReviewCount(true);
  const close = () => setSheetOpen(false);
  return (
    <Modal open onOpenChange={(next) => !next && close()} title={sessionChipLabel(status)}>
      <div className="session-sheet">
        <p className="text-sm text-muted">
          {status.active
            ? `Running: ${status.name}.`
            : `No session is running. The next one is session ${status.number}.`}
        </p>
        <div className="session-sheet-actions">
          <AppLink href="/?view=home#sessions" className="quick-action primary" onClick={close}>
            {status.active ? "End & start next" : "Start session"}
          </AppLink>
          <AppLink href="/features/time" className="quick-action" onClick={close}>
            Session Time
          </AppLink>
        </div>
        {digest.since !== null ? (
          <>
            <h3>Since last session</h3>
            <DigestLines digest={digest} pending={pending} onNavigate={close} />
            <AppLink
              href="/?view=home#since-last-session"
              className="settings-link"
              onClick={close}
            >
              Open on the Desk<span aria-hidden="true">›</span>
            </AppLink>
          </>
        ) : (
          <p className="text-sm text-muted">
            After your first session ends, this shows what happened since.
          </p>
        )}
      </div>
    </Modal>
  );
}
