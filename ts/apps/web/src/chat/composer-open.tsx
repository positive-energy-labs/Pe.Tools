/**
 * The composer's document entry has two modes: `target` (the existing session › document ladder,
 * which moves the thread head) and `open` (the patch bay, over the composer, to open a document
 * into a Revit first). One `Switcher` beside the ladder picks; closing the bay returns to target.
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";

import { PopupFrame } from "@pe/kit/lang/list-popup";
import { Switcher } from "#/components/lang/switcher";
import { machineOf } from "#/machine/model";
import { useMachine } from "#/machine/use-machine";
import { PatchBay, useBayReadings } from "#/open/bay";

type Mode = "target" | "open";

/** `switcher` false hides the mode words (the one-line composer); the ladder keeps its place. */
export function ComposerOpenMode({
  switcher,
  children,
}: {
  switcher: boolean;
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("target");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <span ref={setAnchor} className="contents">
        {switcher ? (
          <Switcher
            ariaLabel="document mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "target", label: "target", title: "the open document this chat runs on" },
              { value: "open", label: "open", title: "open a document into a Revit first" },
            ]}
          />
        ) : null}
      </span>
      {mode === "target" ? children : null}
      <Popover.Root
        open={mode === "open"}
        onOpenChange={(open) => {
          if (!open) setMode("target");
        }}
      >
        <PopupFrame anchor={anchor} side="top" align="start" label="open a document" wide>
          {mode === "open" ? <ComposerBay /> : null}
        </PopupFrame>
      </Popover.Root>
    </>
  );
}

function ComposerBay() {
  const { reading, fixture } = useMachine();
  const machine = machineOf(reading);
  const { rows, threads, loading } = useBayReadings(machine, fixture);
  return (
    <div className="flex h-[28rem] w-full flex-col p-(--gutter)" data-testid="composer-bay">
      <PatchBay
        machine={machine}
        loading={loading || reading.state === "loading"}
        rows={rows}
        threads={threads}
        fixture={fixture}
        layout="row"
      />
    </div>
  );
}
