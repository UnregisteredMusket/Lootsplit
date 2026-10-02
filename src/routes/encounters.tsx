import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { EncounterWorkspace } from "@/components/encounters/workspace";
export const Route = createFileRoute("/encounters")({ component: Encounters });
function Encounters() {
  return (
    <Shell>
      <EncounterWorkspace />
    </Shell>
  );
}
