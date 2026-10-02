import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { CharacterWorkspace } from "@/components/characters/workspace";
export const Route = createFileRoute("/characters")({ component: Characters });
function Characters() {
  return (
    <Shell>
      <CharacterWorkspace />
    </Shell>
  );
}
