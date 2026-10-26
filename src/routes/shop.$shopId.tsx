import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { ShopContent } from "@/components/shop-content";
export const Route = createFileRoute("/shop/$shopId")({
  // Sell to shop from Party → Funds & inventory: the counter opens with this holding chosen.
  validateSearch: (search: Record<string, unknown>): { sell?: string } =>
    typeof search.sell === "string" && search.sell.length > 0 && search.sell.length <= 150
      ? { sell: search.sell }
      : {},
  component: ShopPage,
});
function ShopPage() {
  const { shopId } = Route.useParams();
  const { sell } = Route.useSearch();
  return (
    <Shell>
      <ShopContent key={shopId} shopId={shopId} sellHoldingId={sell} />
    </Shell>
  );
}
