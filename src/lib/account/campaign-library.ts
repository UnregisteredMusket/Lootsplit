type Member = {
  name: string;
  code: string;
  role: "dm" | "player" | null;
  archived: number;
  closed: boolean;
  viewOnly?: boolean;
};
export type CampaignFilters = { search: string; role: string; state: string; archived: boolean };
/** Names filter only; codes remain the identity and no entries are merged. */
export function filterAccountCampaigns<T extends Member>(members: T[], filters: CampaignFilters) {
  const search = filters.search.trim().toLowerCase();
  return members.filter(
    (m) =>
      (filters.archived || !m.archived) &&
      `${m.name} ${m.code}`.toLowerCase().includes(search) &&
      (filters.role === "all" ||
        (filters.role === "unavailable" ? !m.role : m.role === filters.role)) &&
      (filters.state === "all" ||
        (filters.state === "closed"
          ? m.closed
          : filters.state === "viewing"
            ? !m.closed && m.viewOnly
            : !m.closed && !m.viewOnly)),
  );
}
