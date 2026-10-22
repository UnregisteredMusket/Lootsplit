import { createFileRoute } from "@tanstack/react-router";

/** Seat-authorized shared map image (tabletop protocol 4); see room-image-route.server.ts. */
export const Route = createFileRoute("/api/room-image/$code/$hash")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { roomImageResponse } = await import("@/lib/quire/room-image-route.server");
        return roomImageResponse(request, params);
      },
      HEAD: async ({ request, params }) => {
        const { roomImageResponse } = await import("@/lib/quire/room-image-route.server");
        return roomImageResponse(request, params);
      },
    },
  },
});
