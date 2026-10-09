import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { formatCopper } from "@/lib/quire/money";
import { emptyCloudTable } from "@/lib/quire/cloud";
import { readFinance } from "@/lib/quire/finance";
import {
  readEstate,
  estateTemplateSchema,
  recipeSchema,
  type Estate,
  type EstateJob,
  type EstateOrder,
  type EstateSite,
  type EstateTemplate,
} from "@/lib/quire/estate-schema";
import {
  estateCapabilities,
  estateTemplates,
  physicallyHere,
  storageWeight,
} from "@/lib/quire/estate";
import { ESTATE_CATALOGUE, estatePreset } from "@/lib/quire/estate-catalogue";
import {
  estateImportSchema,
  estateImportFingerprint,
  previewEstateImport,
  type EstateImport,
} from "@/lib/quire/estate-import";
import { locationLabel, readMarketLocations } from "@/lib/quire/shop-locations";
import type { CommandInput } from "@/lib/quire/commands";
import type { Holding } from "@/lib/quire/types";
import { Button, Field, Fold, Select, TextArea, TextInput } from "./ui";
import { AppLink } from "./app-link";
import "./property-operations.css";

function useEstateTable() {
  const e = useEconomy();
  return {
    ...emptyCloudTable(),
    purses: e.purses,
    holdings: e.holdings,
    shops: e.shops,
    stock: e.stock,
    listings: e.listings,
    journal: e.journal,
    sheets: e.sheets,
  };
}
function useEstateActor() {
  return (
    useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable).seatId || "local"
  );
}
function ActionForm({
  title,
  children,
  command,
  label = "Save",
  disabled = false,
  onAccepted,
}: {
  title: string;
  children: ReactNode;
  command: () => CommandInput;
  label?: string;
  disabled?: boolean;
  onAccepted?: () => void;
}) {
  const { commandOutcome } = useEconomy(),
    seat = useSeat(),
    room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useDraftGuard(dirty, "property operation");
  const locked = disabled || busy || (room.joined && room.viewOnly && seat.role === "player");
  return (
    <form
      className="estate-form"
      aria-label={title}
      onChangeCapture={() => setDirty(true)}
      onSubmit={async (e) => {
        e.preventDefault();
        if (locked) return;
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const outcome = await commandOutcome(command());
          setNotice(mutationNotice(outcome, `${title} recorded.`));
          setDirty(false);
          if (outcome.status === "committed") onAccepted?.();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "This property operation could not be recorded.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={locked}>
        <legend>{title}</legend>
        <div className="estate-fields">{children}</div>
        <Button type="submit" disabled={locked}>
          {busy ? "Recording…" : label}
        </Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {room.joined && room.viewOnly && seat.role === "player" && (
        <p>Leave the historical view to make changes.</p>
      )}
    </form>
  );
}
function NumberField({
  label,
  value,
  set,
  min = 0,
  max = 1e12,
  step = 1,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Field label={label}>
      <TextInput
        type="number"
        required
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </Field>
  );
}
function Tick({
  label,
  checked,
  set,
}: {
  label: string;
  checked: boolean;
  set: (v: boolean) => void;
}) {
  return (
    <label className="estate-tick">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}
const uid = () => crypto.randomUUID();

export function PropertyOperations({ holding: h }: { holding: Holding }) {
  const t = useEstateTable(),
    seat = useSeat(),
    state = readEstate(t.journal?.propertyOperations),
    site = state.sites.find((s) => s.propertyId === h.id),
    dm = seat.role === "dm";
  const here = physicallyHere(t, h);
  return (
    <section className="estate-operations" aria-label={`${h.name} operations`}>
      <h3>Property operations</h3>
      <p>
        {site?.enabled ? "Operations enabled" : "Awaiting DM setup"} ·{" "}
        {here ? "Party is at this location" : "Remote reports · travel here to move goods"}
      </p>
      {dm && (
        <Fold title="Property settings & permissions">
          <SiteSettings key={JSON.stringify(site)} holding={h} state={state} />
        </Fold>
      )}
      {site && (
        <>
          <p>
            {estateTemplates(state, site)
              .map((t) => t.name)
              .join(" · ")}
          </p>
          {(estateCapabilities(state, site).has("storage") ||
            estateCapabilities(state, site).has("construction-site")) && (
            <Fold
              title="Storage & material staging"
              hint={`${storageWeight(t, h.id).weight} weight stored`}
            >
              <Storage holding={h} site={site} state={state} />
            </Fold>
          )}
          <Fold
            title="Construction, upgrades & downtime work"
            hint={`${state.jobs.filter((j) => j.propertyId === h.id && ["active", "blocked", "draft"].includes(j.status)).length} ongoing or proposed`}
          >
            <Projects holding={h} site={site} state={state} />
          </Fold>
          <Fold title="Staff & managers">
            <Staff holding={h} state={state} />
          </Fold>
          {estateCapabilities(state, site).has("rental") && (
            <Fold title="Rent & operating finances">
              <Rental
                key={JSON.stringify(state.rentals.find((r) => r.propertyId === h.id))}
                holding={h}
                site={site}
                state={state}
              />
            </Fold>
          )}
          <Fold title="Materials & deliveries">
            <Supplies holding={h} state={state} />
          </Fold>
          <Fold title="Letters & manager orders">
            <Correspondence holding={h} state={state} />
          </Fold>
          {dm && (
            <Fold title="DM handover">
              <Handover holding={h} />
            </Fold>
          )}
          {readFinance(t.journal?.finance)
            .rules.filter((r) => r.holdingId === h.id && r.estateOperation && r.arrears > 0)
            .map((r) => (
              <ActionForm
                key={r.id}
                title={`Settle arrears: ${r.name}`}
                label={`Pay ${formatCopper(r.arrears)}`}
                command={() => ({ kind: "estate-arrears", ruleId: r.id, copper: r.arrears })}
              >
                <p>
                  Recorded unpaid expense: {formatCopper(r.arrears)}. Pausing or dismissing a
                  contract does not forgive it.
                </p>
              </ActionForm>
            ))}
        </>
      )}
      <p>
        <AppLink href="/features/downtime">Review and advance campaign downtime</AppLink> ·{" "}
        <AppLink href="/features/review">DM review inbox</AppLink>
      </p>
    </section>
  );
}
function SiteSettings({ holding: h, state }: { holding: Holding; state: Estate }) {
  const before = state.sites.find((s) => s.propertyId === h.id) ?? null,
    { purses } = useEconomy();
  const [site, setSite] = useState<EstateSite>(
    before ?? {
      propertyId: h.id,
      templateKey: state.templates[0]?.key ?? "",
      enabled: false,
      access: purses.find((p) => p.id === h.purseId)?.kind === "party" ? "party-members" : "owner",
      accessPurseIds: [],
      capacityWeight: null,
      completedTemplates: [],
      notes: "",
    },
  );
  const patch = (p: Partial<EstateSite>) => setSite((s) => ({ ...s, ...p }));
  return (
    <ActionForm
      title="Property settings"
      disabled={!state.templates.length}
      command={() => ({ kind: "estate-site", before, site })}
    >
      {!state.templates.length && (
        <p>
          Create a property template in the DM estate workshop above, or import a reviewed document.
        </p>
      )}
      <Field label="Property template">
        <Select
          value={site.templateKey}
          onChange={(e) => {
            const template = state.templates.find((t) => t.key === e.target.value)!;
            patch({
              templateKey: template.key,
              capacityWeight: template.storage?.capacityWeight ?? null,
            });
          }}
        >
          {state.templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Tick
        label="Enable this property's operations"
        checked={site.enabled}
        set={(enabled) => patch({ enabled })}
      />
      <Field label="Storage access">
        <Select
          value={site.access}
          onChange={(e) => patch({ access: e.target.value as EstateSite["access"] })}
        >
          <option value="owner">Owner only</option>
          <option value="party-members">Assigned party characters (party property)</option>
          <option value="selected">Owner and selected characters</option>
        </Select>
      </Field>
      {site.access === "selected" && (
        <div>
          {purses
            .filter((p) => p.kind === "character")
            .map((p) => (
              <Tick
                key={p.id}
                label={p.name}
                checked={site.accessPurseIds.includes(p.id)}
                set={(yes) =>
                  patch({
                    accessPurseIds: yes
                      ? [...site.accessPurseIds, p.id]
                      : site.accessPurseIds.filter((id) => id !== p.id),
                  })
                }
              />
            ))}
        </div>
      )}
      <Tick
        label="Require DM approval before player withdrawals"
        checked={!!site.withdrawalApproval}
        set={(withdrawalApproval) => patch({ withdrawalApproval })}
      />
      <Tick
        label="Unlimited storage weight"
        checked={site.capacityWeight === null}
        set={(yes) => patch({ capacityWeight: yes ? null : 0 })}
      />
      {site.capacityWeight !== null && (
        <NumberField
          label="Storage weight capacity"
          value={site.capacityWeight}
          step={0.01}
          set={(capacityWeight) => patch({ capacityWeight })}
        />
      )}
      <Field label="Operating notes">
        <TextArea value={site.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </Field>
    </ActionForm>
  );
}
function Storage({
  holding: h,
  site,
  state,
}: {
  holding: Holding;
  site: EstateSite;
  state: Estate;
}) {
  const t = useEstateTable(),
    seat = useSeat(),
    dm = seat.role === "dm",
    actorId = useEstateActor(),
    [direction, setDirection] = useState<"deposit" | "withdraw">("deposit"),
    [item, setItem] = useState(""),
    [quantity, setQuantity] = useState(1),
    [purseId, setPurseId] = useState(seat.purseIds[0] ?? t.purses[0]?.id ?? ""),
    [override, setOverride] = useState(false),
    [donate, setDonate] = useState(false);
  const stored = t.holdings.filter(
      (i) => i.custody?.kind === "property" && i.custody.propertyId === h.id,
    ),
    options =
      direction === "deposit"
        ? t.holdings.filter(
            (i) =>
              i.kind === "item" &&
              !i.service &&
              !i.custody &&
              !i.reservedFor &&
              (dm || seat.purseIds.includes(i.purseId)),
          )
        : stored.filter((i) => !i.reservedFor);
  const approval = state.withdrawals.find(
    (r) =>
      r.propertyId === h.id &&
      r.holdingId === (item || options[0]?.id) &&
      r.purseId === purseId &&
      r.quantity === quantity &&
      r.requestedBy === actorId &&
      r.status === "approved",
  );
  const used = storageWeight(t, h.id),
    canMove = site.enabled && (physicallyHere(t, h) || (dm && override));
  return (
    <>
      <p>
        Weight {used.weight}
        {site.capacityWeight === null ? " · unlimited capacity" : ` / ${site.capacityWeight}`}
        {used.unknown ? " · some weights need DM review" : ""}. Withdrawal assigns the retrieved lot
        to the selected character. Deposits retain ownership until withdrawal.
      </p>
      <ul className="estate-records">
        {stored.map((i) => (
          <li key={i.id}>
            <strong>
              {i.quantity} × {i.name}
            </strong>
            <p>
              Owned by {t.purses.find((p) => p.id === i.purseId)?.name ?? "Campaign account"}
              {i.reservedFor ? " · reserved for a project" : ""} · weight {i.weight ?? "unknown"}{" "}
              each
            </p>
            {dm && (
              <MaterialTag key={`${i.id}:${i.materialKey}:${i.weight}`} item={i} state={state} />
            )}
          </li>
        ))}
      </ul>
      {!stored.length && <p>Storage is empty.</p>}
      {site.withdrawalApproval && (
        <p>
          Player withdrawals require DM approval. Approval leaves goods stored until the assigned
          recipient collects them at this location.
        </p>
      )}
      <WithdrawalRequests propertyId={h.id} state={state} />
      <ActionForm
        title="Move stored goods"
        disabled={!canMove}
        label={
          direction === "deposit"
            ? "Deposit items"
            : !dm && site.withdrawalApproval
              ? approval
                ? "Collect approved withdrawal"
                : "Request withdrawal"
              : "Withdraw items"
        }
        command={() => ({
          kind: "estate-storage",
          propertyId: h.id,
          holdingId: item || options[0]?.id || "",
          quantity,
          direction,
          purseId,
          override,
          donate,
          ...(approval ? { approvalId: approval.id } : {}),
        })}
      >
        <Field label="Storage action">
          <Select
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value as typeof direction);
              setItem("");
            }}
          >
            <option value="deposit">Deposit carried items</option>
            <option value="withdraw">Withdraw stored items</option>
          </Select>
        </Field>
        <Field label="Item lot">
          <Select value={item || options[0]?.id || ""} onChange={(e) => setItem(e.target.value)}>
            {!options.length && <option value="">No available goods</option>}
            {options.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · {i.quantity} available
              </option>
            ))}
          </Select>
        </Field>
        {direction === "deposit" && (
          <Tick
            label="Donate deposited goods to the property owner for shared work"
            checked={donate}
            set={setDonate}
          />
        )}
        <NumberField
          label="Item quantity"
          value={quantity}
          min={1}
          max={100000}
          set={setQuantity}
        />
        <Field label="Acting / receiving character">
          <Select value={purseId} onChange={(e) => setPurseId(e.target.value)}>
            {t.purses
              .filter((p) => dm || seat.purseIds.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      </ActionForm>
      {dm && (
        <Tick
          label="Record a DM location override for this movement"
          checked={override}
          set={setOverride}
        />
      )}
      {!physicallyHere(t, h) && (
        <p>
          Set the party location through <AppLink href="/features/shops">market locations</AppLink>{" "}
          before moving goods.
        </p>
      )}
    </>
  );
}
function WithdrawalRequests({
  state,
  propertyId,
  pendingOnly = false,
}: {
  state: Estate;
  propertyId?: string;
  pendingOnly?: boolean;
}) {
  const t = useEstateTable(),
    seat = useSeat(),
    dm = seat.role === "dm",
    actorId = useEstateActor();
  const requests = state.withdrawals.filter(
    (r) =>
      (!propertyId || r.propertyId === propertyId) &&
      (!pendingOnly || r.status === "pending") &&
      (dm || r.requestedBy === actorId),
  );
  return (
    <>
      {requests.map((r) => (
        <article className="estate-record" key={JSON.stringify(r)}>
          <h4>
            Withdrawal: {r.quantity} ×{" "}
            {t.holdings.find((h) => h.id === r.holdingId)?.name ?? "Stored item"} · {r.status}
          </h4>
          <p>
            Recipient: {t.purses.find((p) => p.id === r.purseId)?.name ?? "Character"}. {r.reason}
          </p>
          {["pending", "approved"].includes(r.status) && (
            <>
              {dm && r.status === "pending" && <WithdrawalDecision request={r} status="approved" />}
              {dm && <WithdrawalDecision request={r} status="denied" />}
              <WithdrawalDecision request={r} status="cancelled" />
            </>
          )}
        </article>
      ))}
    </>
  );
}
function WithdrawalDecision({
  request,
  status,
}: {
  request: Estate["withdrawals"][number];
  status: "approved" | "denied" | "cancelled";
}) {
  const [reason, setReason] = useState("");
  return (
    <ActionForm
      title={`Withdrawal ${status}`}
      label={
        status === "approved"
          ? "Approve withdrawal"
          : status === "denied"
            ? "Deny withdrawal"
            : "Cancel withdrawal"
      }
      command={() => ({
        kind: "estate-withdrawal-review",
        requestId: request.id,
        before: canonicalJson(request),
        status,
        reason,
      })}
    >
      <Field label="Withdrawal decision reason">
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ActionForm>
  );
}
function MaterialTag({ item, state }: { item: Holding; state: Estate }) {
  const [materialKey, setMaterialKey] = useState(item.materialKey ?? state.materials[0]?.key ?? ""),
    [weight, setWeight] = useState(item.weight ?? 0);
  return (
    <details>
      <summary>DM material & weight review</summary>
      <ActionForm
        title={`Material review: ${item.name}`}
        disabled={!state.materials.length}
        command={() => ({ kind: "estate-material", holdingId: item.id, materialKey, weight })}
      >
        <Field label="Material definition">
          <Select value={materialKey} onChange={(e) => setMaterialKey(e.target.value)}>
            {state.materials.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name} ({m.unit})
              </option>
            ))}
          </Select>
        </Field>
        <NumberField
          label="Weight per item"
          value={weight}
          max={9999}
          step={0.01}
          set={setWeight}
        />
      </ActionForm>
    </details>
  );
}
function Projects({
  holding: h,
  site,
  state,
}: {
  holding: Holding;
  site: EstateSite;
  state: Estate;
}) {
  const t = useEstateTable(),
    seat = useSeat(),
    dm = seat.role === "dm",
    recipes = estateTemplates(state, site).flatMap((t) => t.recipes ?? []);
  const [recipeKey, setRecipeKey] = useState(recipes[0]?.key ?? ""),
    [purseId, setPurseId] = useState(dm ? h.purseId : (seat.purseIds[0] ?? "")),
    [workers, setWorkers] = useState<Record<string, number>>({}),
    [paidWorkers, setPaidWorkers] = useState(0),
    [notes, setNotes] = useState("");
  const recipe = recipes.find((r) => r.key === recipeKey) ?? recipes[0];
  return (
    <>
      <p>
        Building work, repairs, gathering and production use DM-reviewed recipes. Assignments share
        a character's downtime day. Materials are reserved and consumed at each completed stage.
      </p>
      {state.jobs
        .filter((j) => j.propertyId === h.id)
        .map((j) => (
          <JobCard key={JSON.stringify(j)} job={j} />
        ))}
      <ActionForm
        title="Plan property work"
        label={dm ? "Approve work plan" : "Submit for DM review"}
        disabled={!recipe || !site.enabled}
        command={() => {
          if (!recipe) throw Error("Choose a reviewed recipe.");
          return {
            kind: "estate-job",
            before: null,
            job: {
              id: uid(),
              propertyId: h.id,
              purseId,
              name: recipe.name,
              recipeKey: recipe.key,
              recipe,
              status: dm ? "active" : "draft",
              stage: 0,
              progress: 0,
              paidProgress: 0,
              paidCopper: 0,
              assignments: Object.entries(workers)
                .filter(([, share]) => share > 0)
                .map(([purseId, share]) => ({ purseId, share })),
              paidWorkers,
              approvedChecks: false,
              checkNotes: notes,
              message: "Awaiting materials and any required DM checks.",
              requestedBy: "local",
              createdDay: readFinance(t.journal?.finance).day,
            },
          };
        }}
      >
        <Field label="Work recipe">
          <Select
            value={recipeKey || recipe?.key || ""}
            onChange={(e) => setRecipeKey(e.target.value)}
          >
            {!recipes.length && <option value="">DM: add a recipe in the estate workshop</option>}
            {recipes.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pay contractors from">
          <Select value={purseId} onChange={(e) => setPurseId(e.target.value)}>
            {t.purses
              .filter((p) => dm || seat.purseIds.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        {recipe && (
          <p>
            {recipe.laborDays} full labor days · full paid-labor quote{" "}
            {formatCopper(recipe.laborCostCopper)}. {recipe.requirement}{" "}
            {recipe.materials
              .map(
                (m) =>
                  `${m.quantity} ${state.materials.find((x) => x.key === m.materialKey)?.name ?? m.materialKey}`,
              )
              .join(" · ")}
          </p>
        )}
        {t.purses
          .filter((p) => p.kind === "character" && !p.nonParty && (dm || seat.purseIds.includes(p.id)))
          .map((p) => (
            <NumberField
              key={p.id}
              label={`${p.name}: share of downtime day (%)`}
              value={workers[p.id] ?? 0}
              max={100}
              set={(share) => setWorkers((w) => ({ ...w, [p.id]: share }))}
            />
          ))}
        <NumberField
          label="Paid full-day workers"
          value={paidWorkers}
          max={100}
          set={setPaidWorkers}
        />
        <Field label="Tools, checks & work notes">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </ActionForm>
    </>
  );
}
function JobCard({ job: j }: { job: EstateJob }) {
  const dm = useSeat().role === "dm",
    [reason, setReason] = useState(""),
    [stage, setStage] = useState(j.stage),
    [progress, setProgress] = useState(j.progress / 100),
    [action, setAction] = useState<"complete" | "adjust">("adjust");
  const closed = ["completed", "cancelled", "denied"].includes(j.status);
  return (
    <article className="estate-record">
      <h4>
        {j.name} · {j.status}
      </h4>
      <p>{j.message}</p>
      <p>
        Stage {j.stage + 1} · {j.progress / 100} labor days · paid {formatCopper(j.paidCopper)}
      </p>
      <p>{j.checkNotes}</p>
      {dm && !closed && (
        <>
          <div className="estate-actions">
            {["active", "paused", "cancelled", ...(j.status === "draft" ? ["denied"] : [])].map(
              (status) => (
                <ActionForm
                  key={status}
                  title={`${status === "active" ? "Approve / resume" : status} ${j.name}`}
                  label={status === "active" ? "Approve / resume" : status}
                  command={() => ({
                    kind: "estate-job",
                    before: j,
                    job: { ...j, status: status as EstateJob["status"] },
                  })}
                >
                  <span />
                </ActionForm>
              ),
            )}
          </div>
          {(j.recipe.requirement || j.recipe.stages?.some((s) => s.requirement)) && (
            <ActionForm
              title={`Approve checks: ${j.name}`}
              command={() => ({
                kind: "estate-job",
                before: j,
                job: { ...j, approvedChecks: true },
              })}
            >
              <p>
                Confirm the recorded tools, skills and checks using the existing character sheet and
                roll controls.
              </p>
            </ActionForm>
          )}
          <JobPlanEditor job={j} />
          <details>
            <summary>DM progress correction or completion</summary>
            <ActionForm
              title={`DM correction: ${j.name}`}
              command={() => ({
                kind: "estate-job-resolution",
                jobId: j.id,
                before: j,
                action,
                stage,
                progress: Math.round(progress * 100),
                reason,
              })}
            >
              <Field label="Correction action">
                <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
                  <option value="adjust">Adjust remaining stage progress</option>
                  <option value="complete">Complete with a recorded DM override</option>
                </Select>
              </Field>
              <NumberField
                label="Stage number (starting at zero)"
                value={stage}
                max={19}
                set={setStage}
              />
              <NumberField
                label="Labor days completed in stage"
                value={progress}
                step={0.01}
                set={setProgress}
              />
              <Field label="Reason for correction">
                <TextArea required value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <p>
                Paid receipts remain unchanged. Forced completion consumes held reservations and
                records any waived inputs in this reason.
              </p>
            </ActionForm>
          </details>
        </>
      )}
    </article>
  );
}
function JobPlanEditor({ job: before }: { job: EstateJob }) {
  const { purses } = useEconomy(),
    [job, setJob] = useState(before);
  return (
    <details>
      <summary>Edit work allocations & checks</summary>
      <ActionForm
        title={`Work allocation: ${before.name}`}
        command={() => ({ kind: "estate-job", before, job })}
      >
        <NumberField
          label="Paid workers"
          value={job.paidWorkers}
          max={100}
          set={(paidWorkers) => setJob((j) => ({ ...j, paidWorkers }))}
        />
        {purses
          .filter((p) => p.kind === "character")
          .map((p) => (
            <NumberField
              key={p.id}
              label={`${p.name}: downtime share (%)`}
              value={job.assignments.find((a) => a.purseId === p.id)?.share ?? 0}
              max={100}
              set={(share) =>
                setJob((j) => ({
                  ...j,
                  assignments: [
                    ...j.assignments.filter((a) => a.purseId !== p.id),
                    ...(share > 0 ? [{ purseId: p.id, share }] : []),
                  ],
                }))
              }
            />
          ))}
        <Tick
          label="Tools, location and skill checks approved by DM"
          checked={job.approvedChecks}
          set={(approvedChecks) => setJob((j) => ({ ...j, approvedChecks }))}
        />
        <Field label="Work / roll notes">
          <TextArea
            value={job.checkNotes}
            onChange={(e) => setJob((j) => ({ ...j, checkNotes: e.target.value }))}
          />
        </Field>
      </ActionForm>
    </details>
  );
}
function StaffContractEditor({ contract: before }: { contract: Estate["staff"][number] }) {
  const [contract, setContract] = useState(before),
    patch = (p: Partial<typeof contract>) => setContract((c) => ({ ...c, ...p }));
  return (
    <details>
      <summary>Edit contract, wages & delegated authority</summary>
      <ActionForm
        title={`Contract terms: ${before.name}`}
        command={() => ({ kind: "estate-staff", before, staff: contract })}
      >
        <Field label="Employee name">
          <TextInput
            required
            value={contract.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label="Employee role">
          <TextInput
            required
            value={contract.role}
            onChange={(e) => patch({ role: e.target.value })}
          />
        </Field>
        <NumberField
          label="Contract wage (copper)"
          value={contract.wageCopper}
          set={(wageCopper) => patch({ wageCopper })}
        />
        <NumberField
          label="Contract wage period (days)"
          value={contract.periodDays}
          min={1}
          max={3650}
          set={(periodDays) => patch({ periodDays })}
        />
        <Tick
          label="Delegated property manager"
          checked={contract.manager}
          set={(manager) => patch({ manager })}
        />
        <div>
          {(["deliveries", "projects", "rent", "supplies", "staff", "reports"] as const).map(
            (d) => (
              <Tick
                key={d}
                label={d}
                checked={contract.duties.includes(d)}
                set={(yes) =>
                  patch({
                    duties: yes ? [...contract.duties, d] : contract.duties.filter((x) => x !== d),
                  })
                }
              />
            ),
          )}
        </div>
        <NumberField
          label="Manager spending cap (copper)"
          value={contract.budgetCopper}
          set={(budgetCopper) => patch({ budgetCopper })}
        />
        <NumberField
          label="Manager budget period (days)"
          value={contract.budgetPeriodDays}
          min={1}
          max={3650}
          set={(budgetPeriodDays) => patch({ budgetPeriodDays })}
        />
        <Field label="Contract / authority notes">
          <TextArea value={contract.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </Field>
        <p>Paid wages, arrears and spending already recorded are retained.</p>
      </ActionForm>
    </details>
  );
}
function Staff({ holding: h, state }: { holding: Holding; state: Estate }) {
  const t = useEstateTable(),
    seat = useSeat(),
    dm = seat.role === "dm",
    requirements = state.sites.find((s) => s.propertyId === h.id);
  const [name, setName] = useState(""),
    [role, setRole] = useState("manager"),
    [wage, setWage] = useState(0),
    [period, setPeriod] = useState(1),
    [manager, setManager] = useState(false),
    [duties, setDuties] = useState<string[]>([]),
    [budget, setBudget] = useState(0),
    [budgetPeriod, setBudgetPeriod] = useState(30),
    [npcId, setNpcId] = useState(""),
    [notes, setNotes] = useState("");
  return (
    <>
      <p>
        {(requirements &&
          estateTemplates(state, requirements)
            .flatMap((t) => t.staff ?? [])
            .filter((r) => r.minimum)
            .map((r) => `${r.role}: ${r.minimum} for ${r.purpose}`)
            .join(" · ")) ||
          "No required operating staff."}{" "}
        Owning an empty property or using basic storage does not create a worker requirement.
      </p>
      {state.staff
        .filter((c) => c.propertyId === h.id)
        .map((c) => (
          <article className="estate-record" key={c.id}>
            <h4>
              {c.name} · {c.role} · {c.status}
            </h4>
            <p>
              {formatCopper(c.wageCopper)} / {c.periodDays} days
              {c.manager
                ? ` · Manager duties: ${c.duties.join(", ") || "none"} · Budget ${formatCopper(c.budgetSpentCopper)} / ${formatCopper(c.budgetCopper)}`
                : ""}
            </p>
            <p>{c.notes}</p>
            {dm && <StaffContractEditor key={JSON.stringify(c)} contract={c} />}
            {dm && (
              <div className="estate-actions">
                {(
                  [
                    "active",
                    "paused",
                    "dismissed",
                    ...(c.status === "proposed" ? ["denied"] : []),
                  ] as const
                ).map((status) => (
                  <ActionForm
                    key={status}
                    title={`${status} ${c.name}`}
                    label={status === "active" ? "Approve / activate" : status}
                    command={() => ({
                      kind: "estate-staff",
                      before: c,
                      staff: { ...c, status: status as typeof c.status },
                    })}
                  >
                    <span />
                  </ActionForm>
                ))}
              </div>
            )}
          </article>
        ))}
      <ActionForm
        title="Hire property staff"
        label={dm ? "Approve contract" : "Propose hire"}
        command={() => ({
          kind: "estate-staff",
          before: null,
          staff: {
            id: uid(),
            propertyId: h.id,
            name,
            role,
            wageCopper: wage,
            periodDays: period,
            status: dm ? "active" : "proposed",
            manager,
            duties: duties as Estate["staff"][number]["duties"],
            budgetCopper: budget,
            budgetPeriodDays: budgetPeriod,
            budgetStartDay: readFinance(t.journal?.finance).day,
            budgetSpentCopper: 0,
            notes,
            ...(npcId ? { npcId } : {}),
          },
        })}
      >
        <Field label="Staff name">
          <TextInput required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Staff role">
          <TextInput required value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <NumberField label="Wage (copper per period)" value={wage} set={setWage} />
        <NumberField
          label="Wage period (campaign days)"
          value={period}
          min={1}
          max={3650}
          set={setPeriod}
        />
        {dm && (
          <Field label="Optional existing NPC">
            <Select value={npcId} onChange={(e) => setNpcId(e.target.value)}>
              <option value="">No NPC link</option>
              {t.purses
                .filter((p) => p.control === "npc")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Tick label="Manager with delegated duties" checked={manager} set={setManager} />
        {manager && (
          <>
            <div>
              {["deliveries", "projects", "rent", "supplies", "staff", "reports"].map((d) => (
                <Tick
                  key={d}
                  label={d}
                  checked={duties.includes(d)}
                  set={(yes) =>
                    setDuties((old) => (yes ? [...old, d] : old.filter((x) => x !== d)))
                  }
                />
              ))}
            </div>
            <NumberField label="Manager spending cap (copper)" value={budget} set={setBudget} />
            <NumberField
              label="Spending cap period (campaign days)"
              value={budgetPeriod}
              min={1}
              max={3650}
              set={setBudgetPeriod}
            />
          </>
        )}
        <Field label="Contract notes">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </ActionForm>
    </>
  );
}
function Rental({
  holding: h,
  site,
  state,
}: {
  holding: Holding;
  site: EstateSite;
  state: Estate;
}) {
  const dm = useSeat().role === "dm",
    before = state.rentals.find((r) => r.propertyId === h.id) ?? null,
    defaults = estateTemplates(state, site).find((t) => t.rental)?.rental;
  const [rent, setRent] = useState(
    before ?? {
      propertyId: h.id,
      tenant: "",
      occupied: false,
      active: false,
      incomeCopper: defaults?.incomeCopper ?? 0,
      upkeepCopper: defaults?.upkeepCopper ?? 0,
      periodDays: defaults?.periodDays ?? 30,
      notes: "",
    },
  );
  const patch = (p: Partial<typeof rent>) => setRent((r) => ({ ...r, ...p }));
  if (!dm)
    return (
      <p>
        {rent.tenant || "No tenant"} · {rent.occupied ? "Occupied" : "Vacant"} ·{" "}
        {rent.active ? "Rental active" : "Rental paused"}. Rent {formatCopper(rent.incomeCopper)},
        upkeep {formatCopper(rent.upkeepCopper)} per {rent.periodDays} days. The DM controls tenancy
        terms.
      </p>
    );
  return (
    <ActionForm
      title="Rental agreement"
      command={() => ({ kind: "estate-rent", before, rental: rent })}
    >
      <Field label="Tenant / household">
        <TextInput value={rent.tenant} onChange={(e) => patch({ tenant: e.target.value })} />
      </Field>
      <Tick
        label="Tenant is in residence"
        checked={rent.occupied}
        set={(occupied) => patch({ occupied })}
      />
      <Tick
        label="Activate rental schedules"
        checked={rent.active}
        set={(active) => patch({ active })}
      />
      <NumberField
        label="Rent income (copper)"
        value={rent.incomeCopper}
        set={(incomeCopper) => patch({ incomeCopper })}
      />
      <NumberField
        label="Separate upkeep (copper)"
        value={rent.upkeepCopper}
        set={(upkeepCopper) => patch({ upkeepCopper })}
      />
      <NumberField
        label="Rental period (campaign days)"
        value={rent.periodDays}
        min={1}
        max={3650}
        set={(periodDays) => patch({ periodDays })}
      />
      <Field label="Tenancy and owner storage notes">
        <TextArea value={rent.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </Field>
      <p>
        Tenant goods are not added to party inventory. Rent pauses when occupancy, condition or
        required operating staff prevent it; arrears remain recorded.
      </p>
    </ActionForm>
  );
}
function SupplierTerms({ supplier }: { supplier: Estate["suppliers"][number] }) {
  const [draft, setDraft] = useState(supplier);
  const t = useEstateTable(),
    state = readEstate(t.journal?.propertyOperations);
  return (
    <details>
      <summary>
        Edit supplier: {t.stock.find((s) => s.id === supplier.stockId)?.name ?? "Material delivery"}
      </summary>
      <ActionForm
        title="Edit reviewed supplier terms"
        command={() => ({ kind: "estate-supplier", before: supplier, supplier: draft })}
      >
        <Field label="Supplier stock">
          <Select
            value={draft.stockId}
            onChange={(e) => setDraft({ ...draft, stockId: e.target.value })}
          >
            {t.stock
              .filter((s) => !s.service)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {t.shops.find((shop) => shop.id === s.shopId)?.name}: {s.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Material definition">
          <Select
            value={draft.materialKey}
            onChange={(e) => setDraft({ ...draft, materialKey: e.target.value })}
          >
            {state.materials.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name} ({m.unit})
              </option>
            ))}
          </Select>
        </Field>
        <NumberField
          label="Delivery delay (campaign days)"
          value={draft.deliveryDays}
          max={3650}
          set={(deliveryDays) => setDraft({ ...draft, deliveryDays })}
        />
        <NumberField
          label="Delivery fee (copper per shipment)"
          value={draft.deliveryCopper}
          set={(deliveryCopper) => setDraft({ ...draft, deliveryCopper })}
        />
        <NumberField
          label="Authoritative weight per item"
          value={draft.weight}
          max={9999}
          step={0.01}
          set={(weight) => setDraft({ ...draft, weight })}
        />
        <p>
          Existing shipments retain their paid terms. Pending manager instructions recheck the
          current terms before spending.
        </p>
      </ActionForm>
    </details>
  );
}
function Supplies({ holding: h, state }: { holding: Holding; state: Estate }) {
  const t = useEstateTable(),
    dm = useSeat().role === "dm",
    suppliers = state.suppliers.filter((s) => s.propertyId === h.id);
  const [stockId, setStockId] = useState(t.stock.find((s) => !s.service)?.id ?? ""),
    [materialKey, setMaterialKey] = useState(state.materials[0]?.key ?? ""),
    [days, setDays] = useState(2),
    [fee, setFee] = useState(0),
    [weight, setWeight] = useState(0),
    [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? ""),
    [quantity, setQuantity] = useState(1);
  const selected = suppliers.find((s) => s.id === supplierId) ?? suppliers[0];
  return (
    <>
      <p>
        Materials are ordinary shop goods. Delivery buys one real item lot and records its
        destination. Arrivals require storage capacity and a receiving party or authorized manager.
      </p>
      {state.shipments
        .filter((s) => s.propertyId === h.id)
        .map((s) => (
          <article className="estate-record" key={s.id}>
            <h4>
              {t.holdings.find((i) => i.id === s.holdingId)?.name ?? "Material shipment"} ·{" "}
              {s.status}
            </h4>
            <p>
              Sent day {s.sentDay} · due day {s.dueDay} · {s.message}
            </p>
            {["in-transit", "blocked"].includes(s.status) && dm && (
              <div className="estate-actions">
                {["retry", "return"].map((action) => (
                  <ActionForm
                    key={action}
                    title={`${action} delivery`}
                    label={action === "retry" ? "Retry on approved downtime" : "DM retrieve goods"}
                    command={() => ({
                      kind: "estate-shipment",
                      shipmentId: s.id,
                      action: action as "retry" | "return",
                      override: action === "return",
                    })}
                  >
                    <span />
                  </ActionForm>
                ))}
              </div>
            )}
            {dm && t.holdings.find((i) => i.id === s.holdingId) && (
              <MaterialTag item={t.holdings.find((i) => i.id === s.holdingId)!} state={state} />
            )}
          </article>
        ))}
      {dm && (
        <>
          {suppliers.map((supplier) => (
            <SupplierTerms key={JSON.stringify(supplier)} supplier={supplier} />
          ))}
          <ActionForm
            title="Approve a material supplier"
            disabled={!t.stock.length || !state.materials.length}
            command={() => ({
              kind: "estate-supplier",
              before: null,
              supplier: {
                id: uid(),
                propertyId: h.id,
                stockId,
                materialKey,
                deliveryDays: days,
                deliveryCopper: fee,
                weight,
              },
            })}
          >
            <Field label="Supplier stock">
              <Select value={stockId} onChange={(e) => setStockId(e.target.value)}>
                {t.stock
                  .filter((s) => !s.service)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {t.shops.find((shop) => shop.id === s.shopId)?.name}: {s.name} ·{" "}
                      {formatCopper(s.copper)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Material definition">
              <Select value={materialKey} onChange={(e) => setMaterialKey(e.target.value)}>
                {state.materials.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </Select>
            </Field>
            <NumberField
              label="Delivery delay (campaign days)"
              value={days}
              max={3650}
              set={setDays}
            />
            <NumberField label="Delivery fee (copper per shipment)" value={fee} set={setFee} />
            <NumberField
              label="Authoritative weight per item"
              value={weight}
              step={0.01}
              max={9999}
              set={setWeight}
            />
          </ActionForm>
          <ActionForm
            title="Buy materials with delivery"
            disabled={!selected}
            label="Purchase & dispatch"
            command={() => {
              if (!selected) throw Error("Approve a supplier first.");
              return {
                kind: "estate-delivery",
                propertyId: h.id,
                purseId: h.purseId,
                stockId: selected.stockId,
                materialKey: selected.materialKey,
                deliveryDays: selected.deliveryDays,
                deliveryCopper: selected.deliveryCopper,
                quantity,
              };
            }}
          >
            <Field label="Reviewed supplier">
              <Select
                value={supplierId || selected?.id || ""}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t.stock.find((i) => i.id === s.stockId)?.name ?? s.stockId} · {s.deliveryDays}{" "}
                    days · delivery {formatCopper(s.deliveryCopper)}
                  </option>
                ))}
              </Select>
            </Field>
            <NumberField
              label="Materials to purchase"
              value={quantity}
              min={1}
              max={100000}
              set={setQuantity}
            />
          </ActionForm>
        </>
      )}
      {suppliers.length > 0 && (
        <p>Reviewed suppliers are available to delegated managers in Letters & manager orders.</p>
      )}
      <p>
        Players can also buy supplies through <AppLink href="/market">Market stock</AppLink>, bring
        them here and deposit them. The DM reviews their material definition and weight.
      </p>
    </>
  );
}
function OrderFields({
  holding: h,
  state,
  value,
  set,
}: {
  holding: Holding;
  state: Estate;
  value: EstateOrder;
  set: (o: EstateOrder) => void;
}) {
  const t = useEstateTable(),
    supplies = state.suppliers.filter((s) => s.propertyId === h.id),
    jobs = state.jobs.filter(
      (j) => j.propertyId === h.id && ["active", "paused", "blocked"].includes(j.status),
    ),
    staff = state.staff.filter(
      (s) => s.propertyId === h.id && ["active", "paused"].includes(s.status),
    );
  const initial = (kind: EstateOrder["kind"]): EstateOrder =>
    kind === "message"
      ? { kind, text: "" }
      : kind === "report"
        ? { kind }
        : kind === "project"
          ? { kind, jobId: jobs[0]?.id ?? "", active: true }
          : kind === "rent"
            ? { kind, active: true }
            : kind === "staff"
              ? { kind, staffId: staff[0]?.id ?? "", active: true }
              : {
                  kind,
                  stockId: supplies[0]?.stockId ?? "",
                  materialKey: supplies[0]?.materialKey ?? "",
                  deliveryDays: supplies[0]?.deliveryDays ?? 0,
                  deliveryCopper: supplies[0]?.deliveryCopper ?? 0,
                  quantity: 1,
                };
  return (
    <>
      <Field label="Manager instruction">
        <Select
          value={value.kind}
          onChange={(e) => set(initial(e.target.value as EstateOrder["kind"]))}
        >
          <option value="message">Deliver a letter</option>
          <option value="report">Send a property report</option>
          <option value="project">Manage approved work</option>
          <option value="rent">Manage approved tenancy</option>
          <option value="staff">Manage approved staff contract</option>
          <option value="supply">Order reviewed material supplies</option>
        </Select>
      </Field>
      {value.kind === "message" && (
        <Field label="Letter text">
          <TextArea
            required
            maxLength={2000}
            value={value.text}
            onChange={(e) => set({ ...value, text: e.target.value })}
          />
        </Field>
      )}
      {value.kind === "project" && (
        <Field label="Reviewed project">
          <Select value={value.jobId} onChange={(e) => set({ ...value, jobId: e.target.value })}>
            <option value="">Choose approved work</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {value.kind === "staff" && (
        <Field label="Reviewed staff contract">
          <Select
            value={value.staffId}
            onChange={(e) => set({ ...value, staffId: e.target.value })}
          >
            <option value="">Choose approved staff</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {["project", "rent", "staff"].includes(value.kind) && "active" in value && (
        <Tick
          label="Activate (clear to pause)"
          checked={value.active}
          set={(active) => set({ ...value, active })}
        />
      )}
      {value.kind === "supply" && (
        <>
          <Field label="Reviewed material supplier">
            <Select
              value={
                supplies.find(
                  (s) => s.stockId === value.stockId && s.materialKey === value.materialKey,
                )?.id ?? ""
              }
              onChange={(e) => {
                const s = supplies.find((s) => s.id === e.target.value)!;
                set({
                  kind: "supply",
                  stockId: s.stockId,
                  materialKey: s.materialKey,
                  deliveryDays: s.deliveryDays,
                  deliveryCopper: s.deliveryCopper,
                  quantity: value.quantity,
                });
              }}
            >
              <option value="">Choose a reviewed supplier</option>
              {supplies.map((s) => (
                <option key={s.id} value={s.id}>
                  {t.stock.find((i) => i.id === s.stockId)?.name ?? s.stockId} · {s.deliveryDays}{" "}
                  days · delivery {formatCopper(s.deliveryCopper)}
                </option>
              ))}
            </Select>
          </Field>
          <NumberField
            label="Supply quantity"
            value={value.quantity}
            min={1}
            max={100000}
            set={(quantity) => set({ ...value, quantity })}
          />
        </>
      )}
    </>
  );
}
function Correspondence({ holding: h, state }: { holding: Holding; state: Estate }) {
  const t = useEstateTable(),
    seat = useSeat(),
    dm = seat.role === "dm",
    managers = state.staff.filter(
      (s) => s.propertyId === h.id && s.manager && s.status === "active",
    );
  const [senderId, setSenderId] = useState(seat.purseIds[0] ?? h.purseId),
    [managerId, setManagerId] = useState(managers[0]?.id ?? ""),
    [order, setOrder] = useState<EstateOrder>({ kind: "report" }),
    [budget, setBudget] = useState(0),
    [period, setPeriod] = useState(30);
  return (
    <>
      <p>
        Send from a city post office. Postage {formatCopper(state.postal.feeCopper)} · delivery
        after {state.postal.deliveryDays} campaign days. Orders execute only after approved downtime
        and recheck ownership, delegated duties, wages, resources and spending caps.
      </p>
      {state.letters
        .filter((l) => l.propertyId === h.id)
        .map((l) => (
          <article className="estate-record" key={l.id}>
            <h4>
              {l.order.kind === "message" ? "Letter" : `${l.order.kind} order`} · {l.status}
            </h4>
            <p>
              From {t.purses.find((p) => p.id === l.senderId)?.name ?? "Campaign sender"} · sent day{" "}
              {l.sentDay} · due day {l.dueDay}
            </p>
            <p>{l.receipt}</p>
            {["in-transit", "blocked"].includes(l.status) &&
              (dm || seat.purseIds.includes(l.senderId)) && (
                <ActionForm
                  title="Cancel property letter"
                  label="Cancel letter"
                  command={() => ({ kind: "estate-letter-cancel", letterId: l.id })}
                >
                  <p>Postage remains in the ledger.</p>
                </ActionForm>
              )}
          </article>
        ))}
      <ActionForm
        title="Send a property letter"
        disabled={!managers.length}
        label="Pay postage & send"
        command={() => ({
          kind: "estate-letter",
          propertyId: h.id,
          senderId,
          managerId: managerId || managers[0]?.id,
          budgetCopper: budget,
          order,
        })}
      >
        <Field label="Send as">
          <Select
            aria-label="Send as"
            value={senderId}
            onChange={(e) => setSenderId(e.target.value)}
          >
            {t.purses
              .filter((p) => dm || seat.purseIds.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Property manager">
          <Select
            aria-label="Property manager"
            value={managerId || managers[0]?.id || ""}
            onChange={(e) => setManagerId(e.target.value)}
          >
            {!managers.length && <option value="">Hire and authorize a manager first</option>}
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <OrderFields holding={h} state={state} value={order} set={setOrder} />
        <NumberField label="Maximum order spend (copper)" value={budget} set={setBudget} />
      </ActionForm>
      {state.standingOrders
        .filter((o) => o.propertyId === h.id)
        .map((o) => (
          <article className="estate-record" key={o.id}>
            <h4>
              {o.order.kind} standing order · {o.active ? "active" : "paused"}
            </h4>
            <p>
              Next day {o.nextDay} · every {o.periodDays} days · {o.receipt}
            </p>
            {dm && (
              <ActionForm
                title="Change standing order"
                label={o.active ? "Pause order" : "Resume order"}
                command={() => ({
                  kind: "estate-order",
                  before: o,
                  order: { ...o, active: !o.active },
                })}
              >
                <span />
              </ActionForm>
            )}
          </article>
        ))}
      {dm && (
        <ActionForm
          title="Authorize a standing manager order"
          disabled={!managers.length}
          command={() => ({
            kind: "estate-order",
            before: null,
            order: {
              id: uid(),
              propertyId: h.id,
              managerId: managerId || managers[0]?.id,
              order,
              budgetCopper: budget,
              periodDays: period,
              nextDay: readFinance(t.journal?.finance).day + 1,
              active: true,
              receipt: "Awaiting approved campaign downtime.",
            },
          })}
        >
          <Field label="Delegated manager">
            <Select
              value={managerId || managers[0]?.id || ""}
              onChange={(e) => setManagerId(e.target.value)}
            >
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <OrderFields holding={h} state={state} value={order} set={setOrder} />
          <NumberField label="Order spending cap (copper)" value={budget} set={setBudget} />
          <NumberField
            label="Repeat interval (campaign days)"
            value={period}
            min={1}
            max={3650}
            set={setPeriod}
          />
        </ActionForm>
      )}
    </>
  );
}
function Handover({ holding: h }: { holding: Holding }) {
  const { purses } = useEconomy(),
    [toId, setToId] = useState(purses.find((p) => p.id !== h.purseId)?.id ?? ""),
    [reason, setReason] = useState("");
  return (
    <ActionForm
      title="Record an operational property handover"
      command={() => ({ kind: "estate-handover", propertyId: h.id, toId, reason })}
    >
      <Field label="New campaign owner">
        <Select value={toId} onChange={(e) => setToId(e.target.value)}>
          {purses
            .filter((p) => p.id !== h.purseId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Handover terms / DM reason">
        <TextArea required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p>
        This keeps the parcel, deed, goods and financial obligations. The old owner's stored goods
        transfer; other owners' goods retain their ownership. Orders pause for review. Use ordinary
        Give only once operational obligations are resolved.
      </p>
    </ActionForm>
  );
}
export function PropertyOperationReviews() {
  const t = useEstateTable(),
    state = readEstate(t.journal?.propertyOperations);
  if (useSeat().role !== "dm") return null;
  const jobs = state.jobs.filter((j) => j.status === "draft"),
    staff = state.staff.filter((s) => s.status === "proposed"),
    withdrawals = state.withdrawals.filter((r) => r.status === "pending");
  return (
    <section className="estate-operations">
      <h2>Property proposals</h2>
      {!jobs.length && !staff.length && !withdrawals.length && (
        <p>No property work, hires or withdrawals awaiting review.</p>
      )}
      <WithdrawalRequests state={state} pendingOnly />
      {jobs.map((j) => (
        <JobCard key={JSON.stringify(j)} job={j} />
      ))}
      {staff.map((c) => (
        <article className="estate-record" key={c.id}>
          <h3>
            Proposed hire: {c.name} · {c.role}
          </h3>
          <p>
            {formatCopper(c.wageCopper)} per {c.periodDays} days · {c.notes}
          </p>
          <p>
            <AppLink href={`/features/properties#property-${encodeURIComponent(c.propertyId)}`}>
              Review this property's staff and manager permissions
            </AppLink>
          </p>
          {["active", "denied"].map((status) => (
            <ActionForm
              key={status}
              title={`Review ${c.name}`}
              label={status === "active" ? "Approve hire" : "Deny hire"}
              command={() => ({
                kind: "estate-staff",
                before: c,
                staff: { ...c, status: status as typeof c.status },
              })}
            >
              <span />
            </ActionForm>
          ))}
        </article>
      ))}
    </section>
  );
}
export function EstateWorkshop() {
  const t = useEstateTable(),
    state = readEstate(t.journal?.propertyOperations),
    seat = useSeat();
  if (seat.role !== "dm") return null;
  return (
    <section className="estate-operations">
      <Fold
        title="DM estate workshop"
        hint="Templates, work recipes, post offices and reviewed imports"
      >
        <p>
          Set campaign rules before activating properties. Presets provide capabilities and staff
          roles; costs, yields and work remain your decisions.
        </p>
        <TemplateWorkshop key={state.templates.map((t) => t.key).join(",")} state={state} />
        <PostalSettings key={JSON.stringify(state.postal)} state={state} />
        <EstateImporter />
      </Fold>
    </section>
  );
}
function TemplateWorkshop({ state }: { state: Estate }) {
  const [selected, setSelected] = useState("new"),
    [preset, setPreset] = useState("warehouse"),
    [draft, setDraft] = useState<EstateTemplate>(estatePreset("warehouse")),
    [advanced, setAdvanced] = useState(""),
    [materialKey, setMaterialKey] = useState("timber"),
    [materialName, setMaterialName] = useState("Building timber"),
    [materialUnit, setMaterialUnit] = useState("bundle");
  const prior = state.templates.find((t) => t.key === selected) ?? null;
  const patch = (p: Partial<EstateTemplate>) => {
    setDraft((t) => ({ ...t, ...p }));
    setAdvanced("");
  };
  return (
    <>
      <Field label="Edit a property template">
        <Select
          value={selected}
          onChange={(e) => {
            const key = e.target.value;
            setSelected(key);
            setDraft(state.templates.find((t) => t.key === key) ?? estatePreset(preset));
            setAdvanced("");
          }}
        >
          <option value="new">New template</option>
          {state.templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      {selected === "new" && (
        <Field label="Property / building preset">
          <Select
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              setDraft(estatePreset(e.target.value));
              setAdvanced("");
            }}
          >
            {ESTATE_CATALOGUE.map((r) => (
              <option key={r[0]} value={r[0]}>
                {r[1]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <ActionForm
        title="Save property template"
        command={() => ({
          kind: "estate-template",
          before: prior,
          template: estateTemplateSchema.parse(advanced ? JSON.parse(advanced) : draft),
          materials: state.materials,
        })}
      >
        <Field label="Template key">
          <TextInput
            required
            value={draft.key}
            disabled={!!prior}
            onChange={(e) => patch({ key: e.target.value })}
          />
        </Field>
        <Field label="Template name">
          <TextInput
            required
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <div>
          <p>Capabilities</p>
          {[
            "storage",
            "rental",
            "construction-site",
            "trade",
            "crafting",
            "lodging",
            "farming",
            "extraction",
            "stabling",
            "postal",
            "research",
            "training",
            "healing",
            "administration",
            "defense",
            "transport",
          ].map((c) => (
            <Tick
              key={c}
              label={c}
              checked={draft.capabilities.includes(c as EstateTemplate["capabilities"][number])}
              set={(yes) =>
                patch({
                  capabilities: yes
                    ? [...draft.capabilities, c as EstateTemplate["capabilities"][number]]
                    : draft.capabilities.filter((x) => x !== c),
                })
              }
            />
          ))}
        </div>
        {draft.staff?.map((r, index) => (
          <div key={index}>
            <Field label={`Required staff role ${index + 1}`}>
              <TextInput
                value={r.role}
                onChange={(e) =>
                  patch({
                    staff: draft.staff!.map((old, i) =>
                      i === index ? { ...old, role: e.target.value } : old,
                    ),
                  })
                }
              />
            </Field>
            <NumberField
              label={`${r.role}: minimum for ${r.purpose}`}
              value={r.minimum}
              max={1000}
              set={(minimum) =>
                patch({
                  staff: draft.staff!.map((old, i) => (i === index ? { ...old, minimum } : old)),
                })
              }
            />
            <NumberField
              label={`${r.role}: default wage (copper)`}
              value={r.wageCopper}
              set={(wageCopper) =>
                patch({
                  staff: draft.staff!.map((old, i) => (i === index ? { ...old, wageCopper } : old)),
                })
              }
            />
          </div>
        ))}
        <details className="estate-wide">
          <summary>Advanced template, staged recipes and operating defaults</summary>
          <p>
            Edit the complete template when you need additional roles, stage prerequisites, storage
            defaults or custom output. Changes apply to future plans; approved jobs keep their
            quoted recipe.
          </p>
          <TextArea
            aria-label="Advanced property template JSON"
            rows={12}
            value={advanced || JSON.stringify(draft, null, 2)}
            onChange={(e) => setAdvanced(e.target.value)}
          />
        </details>
      </ActionForm>
      <ActionForm
        title="Add a reviewed material definition"
        command={() => ({
          kind: "estate-template",
          before: prior,
          template: prior ?? draft,
          materials: [{ key: materialKey, name: materialName, unit: materialUnit }],
        })}
      >
        <Field label="Material key">
          <TextInput
            required
            value={materialKey}
            onChange={(e) => setMaterialKey(e.target.value)}
          />
        </Field>
        <Field label="Material name">
          <TextInput
            required
            value={materialName}
            onChange={(e) => setMaterialName(e.target.value)}
          />
        </Field>
        <Field label="Material unit">
          <TextInput
            required
            value={materialUnit}
            onChange={(e) => setMaterialUnit(e.target.value)}
          />
        </Field>
      </ActionForm>
      {prior && (
        <RecipeBuilder
          key={prior.key + JSON.stringify(prior.recipes)}
          template={prior}
          state={state}
        />
      )}
    </>
  );
}
function RecipeBuilder({ template, state }: { template: EstateTemplate; state: Estate }) {
  const [key, setKey] = useState("build-house"),
    [name, setName] = useState("Build a house"),
    [days, setDays] = useState(30),
    [cost, setCost] = useState(0),
    [result, setResult] = useState(""),
    [materials, setMaterials] = useState<Record<string, number>>({}),
    [requirement, setRequirement] = useState(""),
    [outputName, setOutputName] = useState(""),
    [outputQuantity, setOutputQuantity] = useState(1),
    [outputWeight, setOutputWeight] = useState(0),
    [outputValue, setOutputValue] = useState(0),
    [outputMaterial, setOutputMaterial] = useState(""),
    [repair, setRepair] = useState(false);
  return (
    <ActionForm
      title="Add construction, gathering or production recipe"
      command={() => {
        const recipe = recipeSchema.parse({
          key,
          name,
          laborDays: days,
          laborCostCopper: cost,
          materials: Object.entries(materials)
            .filter(([, n]) => n > 0)
            .map(([materialKey, quantity]) => ({ materialKey, quantity })),
          requirement,
          ...(result ? { resultTemplateKey: result } : {}),
          ...(repair ? { resultCondition: "ready" } : {}),
          ...(outputName
            ? {
                output: {
                  name: outputName,
                  quantity: outputQuantity,
                  unitCopper: outputValue,
                  weight: outputWeight,
                  ...(outputMaterial ? { materialKey: outputMaterial } : {}),
                },
              }
            : {}),
        });
        if (template.recipes?.some((r) => r.key === key))
          throw Error(
            "This recipe key already exists; edit it in the advanced template or choose a new key.",
          );
        return {
          kind: "estate-template",
          before: template,
          template: { ...template, recipes: [...(template.recipes ?? []), recipe] },
          materials: state.materials,
        };
      }}
    >
      <Field label="Recipe key">
        <TextInput required value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <Field label="Work name">
        <TextInput required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <NumberField label="Required full labor days" value={days} min={1} max={1e9} set={setDays} />
      <NumberField label="Full contractor labor cost (copper)" value={cost} set={setCost} />
      <Field label="Completed building / upgrade template">
        <Select value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">No attached building result</option>
          {state.templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Tick
        label="Repair property to ready condition on completion"
        checked={repair}
        set={setRepair}
      />
      {state.materials.map((m) => (
        <NumberField
          key={m.key}
          label={`Required ${m.name} (${m.unit})`}
          value={materials[m.key] ?? 0}
          max={1e9}
          set={(quantity) => setMaterials((old) => ({ ...old, [m.key]: quantity }))}
        />
      ))}
      <Field label="Required tools, location, skills or check">
        <TextArea value={requirement} onChange={(e) => setRequirement(e.target.value)} />
      </Field>
      <Field label="Gathered / produced item name (optional)">
        <TextInput value={outputName} onChange={(e) => setOutputName(e.target.value)} />
      </Field>
      {outputName && (
        <>
          <NumberField
            label="Approved item yield"
            value={outputQuantity}
            min={1}
            max={1e9}
            set={setOutputQuantity}
          />
          <NumberField
            label="Produced item value (copper each)"
            value={outputValue}
            set={setOutputValue}
          />
          <NumberField
            label="Produced item weight each"
            value={outputWeight}
            step={0.01}
            max={9999}
            set={setOutputWeight}
          />
          <Field label="Produced material definition">
            <Select value={outputMaterial} onChange={(e) => setOutputMaterial(e.target.value)}>
              <option value="">Ordinary item</option>
              {state.materials.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </ActionForm>
  );
}
function PostalSettings({ state }: { state: Estate }) {
  const { shops } = useEconomy(),
    [postal, setPostal] = useState(state.postal);
  return (
    <Fold title="City post offices & delivery rules">
      <ActionForm
        title="Postal rules"
        command={() => ({ kind: "estate-postal", before: state.postal, postal })}
      >
        <NumberField
          label="Postage per letter (copper)"
          value={postal.feeCopper}
          set={(feeCopper) => setPostal((p) => ({ ...p, feeCopper }))}
        />
        <NumberField
          label="Letter delivery (campaign days)"
          value={postal.deliveryDays}
          max={3650}
          set={(deliveryDays) => setPostal((p) => ({ ...p, deliveryDays }))}
        />
        <div>
          {shops.map((shop) => {
            const office = postal.offices.find((o) => o.shopId === shop.id);
            return (
              <div key={shop.id}>
                <Tick
                  label={`Post office: ${shop.name}`}
                  checked={!!office}
                  set={(yes) =>
                    setPostal((p) => ({
                      ...p,
                      offices: yes
                        ? [...p.offices, { shopId: shop.id, allowTown: false }]
                        : p.offices.filter((o) => o.shopId !== shop.id),
                    }))
                  }
                />
                {office && (
                  <Tick
                    label="DM exception: allow letters from a town"
                    checked={office.allowTown}
                    set={(allowTown) =>
                      setPostal((p) => ({
                        ...p,
                        offices: p.offices.map((o) =>
                          o.shopId === shop.id ? { ...o, allowTown } : o,
                        ),
                      }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
        <p>
          Assign the shop to the existing city or area location. Closed offices and unknown party
          locations cannot dispatch letters.
        </p>
      </ActionForm>
    </Fold>
  );
}
function EstateImporter() {
  const t = useEstateTable(),
    [text, setText] = useState(""),
    [document, setDocument] = useState<EstateImport | null>(null),
    [owners, setOwners] = useState<Record<string, string>>({}),
    [locations, setLocations] = useState<Record<string, string>>({}),
    [before, setBefore] = useState(""),
    [preview, setPreview] = useState<string[]>([]),
    [error, setError] = useState("");
  useDraftGuard(!!text, "property import");
  const clear = () => {
    setPreview([]);
    setBefore("");
  };
  const parse = (value: string) => {
    setText(value);
    clear();
    setDocument(null);
    setError("");
    try {
      setDocument(estateImportSchema.parse(JSON.parse(value)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid property import.");
    }
  };
  return (
    <Fold title="Reviewed property import">
      <p>
        UTF-8 JSON creates inactive holding configurations and sale listings. It does not spend
        money, grant goods, hire staff or invent purchase deeds. Review every owner and location
        before committing.
      </p>
      <p>
        <a href="/download/property-operations.sample.json" download>
          Download sample import
        </a>{" "}
        ·{" "}
        <a href="/download/property-operations.md" download>
          Import format and property instructions
        </a>
      </p>
      <Field label="Choose a property import JSON file">
        <TextInput
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2_000_000) {
              setError("Import files must be below 2 MB.");
              return;
            }
            parse(await file.text());
          }}
        />
      </Field>
      <details>
        <summary>Paste or inspect import JSON</summary>
        <TextArea
          aria-label="Property import JSON"
          rows={10}
          value={text}
          onChange={(e) => parse(e.target.value)}
        />
      </details>
      {error && (
        <p role="alert" className="estate-import-error">
          {error}
        </p>
      )}
      {document && (
        <>
          <p>
            {document.properties.length} property records · {document.templates.length} templates ·{" "}
            {document.materials.length} material definitions
          </p>
          {document.ownerBindings.map((b) => (
            <Field key={b.key} label={b.label}>
              <Select
                value={owners[b.key] ?? ""}
                onChange={(e) => {
                  setOwners((o) => ({ ...o, [b.key]: e.target.value }));
                  clear();
                }}
              >
                <option value="">Map an existing {b.kind} account</option>
                {t.purses
                  .filter((p) => p.kind === b.kind)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ))}
          {document.locations.map((l) => (
            <Field key={l.key} label={`${l.name} (${l.kind})`}>
              <Select
                value={locations[l.key] ?? ""}
                onChange={(e) => {
                  setLocations((old) => ({ ...old, [l.key]: e.target.value }));
                  clear();
                }}
              >
                <option value="">Create this location</option>
                {readMarketLocations(t.journal?.market)
                  .locations.filter((x) => x.kind === l.kind)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {locationLabel(readMarketLocations(t.journal?.market), x.id)}
                    </option>
                  ))}
              </Select>
            </Field>
          ))}
          <Button
            variant="secondary"
            onClick={() => {
              try {
                const next = previewEstateImport(t, document, owners, locations, "preview");
                setBefore(estateImportFingerprint(t));
                setPreview(
                  document.properties
                    .map(
                      (p) =>
                        `${p.name}: ${p.recordKind === "listing" ? `sale listing, ${formatCopper(p.priceCopper!)}` : "inactive owned holding"}${p.parentPropertyKey ? `; attached to ${p.parentPropertyKey}` : ""}`,
                    )
                    .concat([
                      `${next.journal!.market!.locations.length - readMarketLocations(t.journal?.market).locations.length} new locations; no existing holdings or rules replaced.`,
                    ]),
                );
                setError("");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not preview import.");
              }
            }}
          >
            Review import preview
          </Button>
          {!!preview.length && (
            <ActionForm
              title="Commit reviewed property import"
              label="Import reviewed configurations"
              command={() => ({ kind: "estate-import", before, document, owners, locations })}
              onAccepted={() => {
                setText("");
                setDocument(null);
                clear();
              }}
            >
              <ul>
                {preview.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <p>Commit this preview after reviewing the mapping and material / template rules.</p>
            </ActionForm>
          )}
        </>
      )}
    </Fold>
  );
}
