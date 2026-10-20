import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { ShopContent } from "@/components/shop-content";
export const Route = createFileRoute("/shop/$shopId")({ component: ShopPage });
function ShopPage() {
  const { shopId } = Route.useParams();
  return (
    <Shell>
      <ShopContent key={shopId} shopId={shopId} />
    </Shell>
  );
}
