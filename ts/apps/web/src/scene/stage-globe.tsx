/** The orbit globe with the camera's own verbs: one projection control and wiggle, in one place. */
import { Button } from "@pe/kit/lang/button";
import type { LiveOrbit } from "@pe/kit/lang/live-orbit";
import { OrbitMinimap } from "@pe/kit/lang/minimap";
import { useStage } from "./stage-controller";

type Lines = readonly (readonly (readonly number[])[])[];

export function StageGlobe({
  orbit,
  lines,
  litLines,
  selectedLines,
}: {
  orbit: LiveOrbit;
  lines?: Lines;
  litLines?: Lines;
  selectedLines?: Lines;
}) {
  const stage = useStage();
  return (
    <OrbitMinimap orbit={orbit} lines={lines} litLines={litLines} selectedLines={selectedLines}>
      {stage.projection}
      {stage.wiggle && (
        <span data-wiggle="">
          <Button
            label="wiggle"
            reason="Circle the camera briefly for depth, then return to this exact view · W"
            onClick={stage.wiggle}
          >
            wiggle
          </Button>
        </span>
      )}
    </OrbitMinimap>
  );
}
