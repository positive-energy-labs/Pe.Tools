import { Button } from "@pe/kit/lang/button";
import { NarrowChip } from "@pe/kit/lang/chip";
import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { activeSystem, toggleSystem } from "../../selection";

/** Docked above the pane's scroller, so the scope and its exits always remain visible. */
export function OpenSystems({
  system,
  onChange,
}: {
  system: readonly string[];
  onChange: (system: string[]) => void;
}) {
  const active = activeSystem({ system });
  return (
    <div data-open-systems="">
      <ArtifactFrame
        className="flex-none"
        headFit="wrap"
        head={<span data-slot="pane-title">Open systems</span>}
        headTrail={
          <>
            {system.length ? (
              system.map((name) => (
                <NarrowChip
                  key={name}
                  label={name}
                  detail={name === active ? "active" : undefined}
                  selected={name === active}
                  title={
                    name === active
                      ? "Write, heal and fan act on this system. Close it to activate the previous system."
                      : "Close this system; the others stay open."
                  }
                  onRemove={() => onChange(toggleSystem(system, name))}
                />
              ))
            ) : (
              <span className="t-small text-ink-2">Whole document</span>
            )}
            <Button
              label="Clear all open systems"
              refusal={system.length ? undefined : "The whole document is already open"}
              onClick={() => onChange([])}
            >
              Clear all
            </Button>
          </>
        }
      >
        {null}
      </ArtifactFrame>
    </div>
  );
}
