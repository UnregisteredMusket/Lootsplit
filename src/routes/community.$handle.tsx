import { createFileRoute } from "@tanstack/react-router";
import { CommunityProfilePage } from "@/components/website/community";
// One member's community profile. Visibility is enforced by the account API.
export const Route = createFileRoute("/community/$handle")({
  head: () => ({ meta: [{ title: "Community profile · Lootsplitter" }, { name: "robots", content: "noindex" }] }),
  component: function CommunityProfileRoute() {
    const { handle } = Route.useParams();
    return <CommunityProfilePage handle={handle} />;
  },
});
