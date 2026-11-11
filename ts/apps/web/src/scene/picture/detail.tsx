import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import type { Psc1Metadata } from "#/scene/psc1";

/** Shared by every native picture. Only a click may acquire detailed geometry. */
export function DetailedRead({
  metadata,
  pending,
  overview,
  refusal,
  onRead,
}: {
  metadata?: Psc1Metadata | null;
  pending?: boolean;
  overview?: boolean;
  refusal?: string | null;
  onRead: () => void;
}) {
  const cost = metadata?.stamp.geometryCost;
  return (
    <>
      <Button kind="quiet"
        label={overview ? "Use overview" : "Read detailed"}
        busy={pending}
        refusal={refusal}
        reason="Detailed reads use at least 5 ft of context. Revit keeps tessellated geometry in memory until the model closes."
        onClick={onRead}
      >
        {overview ? "Use overview" : "Read detailed"}
      </Button>
      {pending && (
        <Button kind="quiet"
          label="Stop"
          reason="Stop waiting for detail; Revit may finish work already dispatched."
          onClick={onRead}
        >
          Stop
        </Button>
      )}
      {metadata && (
        <OutcomeLine
          kind="advisory"
          label={`Context ${metadata.effectiveContextPaddingFt} ft${cost ? ` / planned ${cost.plannedCount} / newly tessellated ${cost.newlyTessellatedCount} / document holds ${cost.cumulativeTessellatedCount}` : ""}`}
          says="Revit keeps tessellated geometry in memory until the model closes."
        />
      )}
    </>
  );
}
