import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { CharacterWorkspace } from "@/components/characters/workspace";
export const Route = createFileRoute("/characters")({
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" && search.id.length <= 256 ? { id: search.id } : {},
  component: Characters,
});
function Characters() {
  return (
    <Shell>
      <CharacterWorkspace />
    </Shell>
  );
}
