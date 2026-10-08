export type EconomyMutationOutcome = { status: "committed" | "pending" };

/** A rejected write must remain a rejection; an accepted queue is a distinct success. */
export async function acceptedMutation(
  work: () => Promise<unknown>,
  pending: () => boolean,
): Promise<EconomyMutationOutcome> {
  await work();
  return { status: pending() ? "pending" : "committed" };
}

export function mutationNotice(outcome: EconomyMutationOutcome, committed = "Saved.") {
  return outcome.status === "pending"
    ? "Action accepted as pending. Submit your turn or check Multiplayer sync status."
    : committed;
}
