import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useSeat } from "@/lib/quire/seat";
import { PasswordGate } from "@/components/password-gate";
import { Button, Confirm, Fold, TextInput } from "@/components/ui";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { readQuireFile, type QuireFile } from "@/lib/quire/economy";
import { useEconomy } from "@/lib/quire/economy-context";
import { useLibrary } from "@/lib/quire/library";
import {
  isLockedFile,
  loadSeatLock,
  lockFile,
  passwordMatches,
  unlockFile,
  type SeatLock,
} from "@/lib/quire/lock";
import { captureDeviceBackup, getCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { downloadJson } from "@/lib/quire/table";
import {
  listSaves,
  nameFromImport,
  rememberSave,
  removeSave,
  saveDownloadName,
  type LocalSave,
} from "@/lib/quire/saves";

type Ask =
  | { kind: "save"; download?: boolean }
  | { kind: "load"; save: LocalSave }
  | { kind: "export"; save: LocalSave }
  | { kind: "import"; name: string; value: unknown };

export function SaveFolder() {
  const { restoreFile } = useEconomy();
  const seat = useSeat();
  const shared = useSyncExternalStore(subscribeCloudTable, getCloudTable, getCloudTable);
  const { reload } = useLibrary();
  const { campaigns, activeId } = useSyncExternalStore(
    subscribeCampaigns,
    getCampaigns,
    serverCampaigns,
  );
  const campaign = campaigns.find((row) => row.id === activeId) ?? campaigns[0];
  const [name, setName] = useState("");
  const [restoreChoice, setRestoreChoice] = useState<Ask | null>(null);
  const [saves, setSaves] = useState<LocalSave[]>([]);
  const [lock, setLock] = useState<SeatLock | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<LocalSave | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  useEffect(() => {
    if (!campaign) return;
    let cancelled = false;
    listSaves(campaign.id)
      .then((rows) => {
        if (!cancelled) setSaves(rows);
      })
      .catch((error) => {
        if (!cancelled)
          toast.error(error instanceof Error ? error.message : "Could not open saved backups.");
      });
    void loadSeatLock()
      .then((next) => {
        if (!cancelled) setLock(next);
      })
      .catch(() => {
        if (!cancelled) setLock(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campaign]);

  if (!campaign) return null;

  async function refresh() {
    const [rows, nextLock] = await Promise.all([listSaves(campaign.id), loadSeatLock()]);
    setSaves(rows);
    setLock(nextLock);
  }

  async function requirePassword(gate: SeatLock | null, password: string | null) {
    if (!gate?.protectSaves) return;
    if (!password || !(await passwordMatches(password, gate)))
      throw new Error("That password does not match this save.");
  }

  async function plainFrom(value: unknown, password: string | null): Promise<QuireFile> {
    if (!isLockedFile(value)) return readQuireFile(value);
    if (!password) throw new Error("Enter the password for this campaign.");
    return readQuireFile(await unlockFile(value, password));
  }

  async function storePayload(
    gate: SeatLock | null,
    payloadName: string,
    file: QuireFile,
    password: string | null,
  ) {
    const payload =
      gate?.protectSaves && password ? await lockFile(file, password, gate.salt) : file;
    return rememberSave({ name: payloadName, campaignId: campaign.id, file: payload });
  }

  async function finish(
    next: Ask,
    password: string | null,
    gate: SeatLock | null,
    backupPassword?: string,
  ) {
    await requirePassword(gate, password);
    if (next.kind === "save") {
      const saved = await storePayload(
        gate,
        name || campaign.name,
        await captureDeviceBackup(),
        password,
      );
      const shared = next.download
        ? await downloadJson(saveDownloadName(saved.name, saved.savedAt), saved.file)
        : false;
      setName("");
      toast.success(
        next.download && shared
          ? "Backup downloaded and saved in this browser."
          : next.download
            ? "Backup saved in this browser. The file was not shared."
            : "Backup saved in this browser.",
      );
      return;
    }
    if (next.kind === "import") {
      await storePayload(
        gate,
        next.name,
        await plainFrom(next.value, backupPassword ?? password),
        password,
      );
      toast.success("Backup imported.");
      return;
    }
    const plain = await plainFrom(next.save.file, backupPassword ?? password);
    if (next.kind === "load") {
      const file = new File(
        [JSON.stringify(plain)],
        saveDownloadName(next.save.name, next.save.savedAt),
        { type: "application/json" },
      );
      await restoreFile(file, password ?? undefined);
      await reload();
      return;
    }
    const download =
      gate?.protectSaves && password ? await lockFile(plain, password, gate.salt) : plain;
    await downloadJson(saveDownloadName(next.save.name, next.save.savedAt), download);
  }

  function start(next: Ask, confirmed = false) {
    if (next.kind === "load" && !confirmed) {
      setRestoreChoice(next);
      return;
    }
    setBusy(true);
    void (async () => {
      if (next.kind === "load" || next.kind === "export") {
        const saveId = next.save.id;
        const current = (await listSaves(campaign.id)).find((row) => row.id === saveId);
        if (!current) throw new Error("This backup was removed. Refresh the backup list.");
        next = { ...next, save: current };
      }
      const gate = await loadSeatLock();
      setLock(gate);
      const secret =
        next.kind === "load" || next.kind === "export"
          ? next.save.file
          : next.kind === "import"
            ? next.value
            : null;
      if (gate?.protectSaves || (secret && isLockedFile(secret))) {
        setAsk(next);
        return;
      }
      await finish(next, null, gate);
      await refresh();
    })()
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "That save could not be used."),
      )
      .finally(() => setBusy(false));
  }

  return (
    <Fold title="Device backups" hint="Save in this browser or download a backup file." defaultOpen>
      <Confirm
        open={restoreChoice !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreChoice(null);
        }}
        title="Replace the current campaign?"
        body="Loading this backup replaces the current campaign. Export a backup first if you need to keep your latest changes."
        confirmLabel="Load backup"
        onConfirm={() => {
          const choice = restoreChoice;
          setRestoreChoice(null);
          if (choice) start(choice, true);
        }}
      />
      <p className="text-sm text-muted">
        Save stores a named backup in this browser. Export downloads it. Import adds a backup file
        to this list. Load replaces the current campaign with the selected backup. Download backup
        saves the current campaign as a file on your device. Browser copies can be lost if you clear
        site data; keep a downloaded copy too.
        {lock?.protectSaves
          ? " These actions ask for the campaign password, and the file is locked."
          : ""}
      </p>
      {shared.joined ? (
        <p className="mt-3 text-sm text-muted">
          {shared.live ? "Live" : "Turn-based"} backups refresh from the shared campaign first.
          Submit or resolve your pending actions before saving; export pending actions from the sync
          panel to preserve an unfinished turn.
          {shared.role === "player"
            ? " Your backup contains only the data available to your character. The DM should keep the complete campaign backup."
            : " Your backup includes the shared campaign and the books and catalog stored on this device."}{" "}
          Disconnect or return to Local Mode before loading a backup. Loading a file does not
          restore a room connection or overwrite the shared campaign.
        </p>
      ) : null}
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) start({ kind: "save" });
        }}
      >
        <label className="min-w-0 flex-1 text-sm text-muted">
          Save name
          <TextInput
            className="mt-1"
            value={name}
            placeholder={campaign.name}
            aria-label="Save name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2 sm:items-end">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => start({ kind: "save", download: true })}
          >
            Download backup
          </Button>
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-border px-4 text-sm text-fg">
            Import
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const next = event.target.files?.[0];
                event.target.value = "";
                if (!next || busy) return;
                setBusy(true);
                void next
                  .text()
                  .then(async (text) => {
                    const value = JSON.parse(text) as unknown;
                    const gate = await loadSeatLock();
                    setLock(gate);
                    if (gate?.protectSaves || isLockedFile(value)) {
                      setAsk({ kind: "import", name: nameFromImport(next.name), value });
                      return;
                    }
                    await finish(
                      { kind: "import", name: nameFromImport(next.name), value },
                      null,
                      gate,
                    );
                    await refresh();
                  })
                  .catch((error) =>
                    toast.error(
                      error instanceof Error ? error.message : "That file could not be imported.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            />
          </label>
        </div>
      </form>
      {saves.length === 0 ? <p className="mt-4 text-sm text-muted">No saves yet.</p> : null}
      <ul className="mt-2">
        {saves.map((save) => (
          <li key={save.id} className="border-t border-border py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate">
                {save.name}
                {isLockedFile(save.file) ? (
                  <span className="ml-2 text-sm text-muted">Locked</span>
                ) : null}
              </p>
              <p className="shrink-0 text-sm text-muted">
                {new Date(save.savedAt).toLocaleString()}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy || shared.joined || seat.role === "player"}
                onClick={() => start({ kind: "load", save })}
              >
                Load
              </Button>
              <Button variant="secondary" onClick={() => start({ kind: "export", save })}>
                Export
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(save)}>
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <PasswordGate
        open={ask !== null}
        onOpenChange={(open) => {
          if (!open) setAsk(null);
        }}
        title={
          ask?.kind === "load"
            ? "Load this save?"
            : ask?.kind === "export"
              ? "Export this save?"
              : ask?.kind === "import"
                ? "Import this file?"
                : "Save this campaign?"
        }
        showBackupPassword={
          ask?.kind === "import"
            ? isLockedFile(ask.value)
            : ask?.kind === "load" || ask?.kind === "export"
              ? isLockedFile(ask.save.file)
              : false
        }
        body="Enter the campaign password. If the backup was encrypted with a different password, enter that in the second field."
        onSubmit={async (password, backupPassword) => {
          const next = ask;
          if (!next) return;
          await finish(next, password, await loadSeatLock(), backupPassword);
          await refresh();
        }}
      />
      <Confirm
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this save?"
        body="The copy is deleted from this device. The campaign that is open is not changed. Export it first if you still want the file."
        confirmLabel="Remove"
        onConfirm={() => {
          const save = removing;
          if (!save) return;
          void removeSave(save.id)
            .then(() => refresh())
            .then(() => toast.success("Save removed."))
            .catch((error) =>
              toast.error(
                error instanceof Error ? error.message : "That save could not be removed.",
              ),
            );
        }}
      />
    </Fold>
  );
}
