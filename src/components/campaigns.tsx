import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { createCampaign, deleteCampaign, getCampaigns, renameCampaign, serverCampaigns, subscribeCampaigns, switchCampaign } from "@/lib/quire/campaigns";
import { useSeat } from "@/lib/quire/seat";
import { Button, Confirm, TextInput } from "@/components/ui";

export function Campaigns() {
  const seat = useSeat();
  const { campaigns, activeId } = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const active = campaigns.find((campaign) => campaign.id === activeId) ?? campaigns[0];
  const [draft, setDraft] = useState<string | null>(null);
  const [nextName, setNextName] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  if (!active) return null;

  if (seat.role === "player") {
    return (
      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="font-display text-2xl tracking-tight">Campaign</h2>
        <p className="mt-2 text-sm text-muted">
          This phone opened a player link. You cannot create, rename, open, or delete campaigns. The dungeon master keeps those.
        </p>
      </section>
    );
  }

  const name = draft ?? active.name;

  return (
    <section className="mt-6 rounded-lg border border-border p-4">
      <h2 className="font-display text-2xl tracking-tight">Campaigns</h2>
      <p className="mt-2 text-sm text-muted">Each campaign has its own shops, money, index, names, and PDFs. The app uses the one that is open.</p>
      <label className="mt-4 block text-sm text-muted">
        Open campaign
        <TextInput
          className="mt-1"
          aria-label="Campaign name"
          value={name}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== null && draft.trim() && draft.trim() !== active.name) renameCampaign(active.id, draft);
            setDraft(null);
          }}
        />
      </label>
      {campaigns.length > 1 ? (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {campaigns.filter((campaign) => campaign.id !== active.id).map((campaign) => (
            <li key={campaign.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{campaign.name}</span>
              <span className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => switchCampaign(campaign.id)}>
                  Open
                </Button>
                <Button variant="danger" onClick={() => setRemoving(campaign.id)}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          createCampaign(nextName);
          setNextName("");
          toast.success("New campaign opened. The others are still saved on this device.");
        }}
      >
        <TextInput
          aria-label="New campaign name"
          placeholder="Campaign name"
          value={nextName}
          onChange={(event) => setNextName(event.target.value)}
        />
        <Button type="submit" variant="secondary">
          New campaign
        </Button>
      </form>
      <Confirm
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title="Remove this campaign?"
        body="Its shops, money, index, and PDFs are deleted from this device. The campaign that is open is not deleted."
        confirmLabel="Remove"
        onConfirm={() => {
          const id = removing;
          setRemoving(null);
          if (!id) return;
          void deleteCampaign(id).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "That campaign could not be removed."));
        }}
      />
    </section>
  );
}
