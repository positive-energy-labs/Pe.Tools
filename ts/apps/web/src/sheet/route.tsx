import { RegistryContext } from "@effect/atom-react";
import { useState } from "react";
import type { DocumentRef } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { Surface } from "@pe/kit/lang/surface";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { defineRoute, RouteShell, useRoute } from "#/route";
import { useChooseTarget } from "#/route/shell";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import { NativeObservationScope } from "#/revit/observation";
import { showInRevit } from "#/revit/element-menu";
import { useSheet } from "./use-sheet";
import { Roster, FanSheet } from "./view";
import { SheetPicture } from "./picture";
import { SheetInputs } from "./inputs";

const manifest = defineRoute({ key: "sheet", name: "Pressure sheet", needs: "document" });

export function SheetWorkspace({ target }: { target: DocumentRef }) {
  const state = useSheet(target);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const scope = { document: target, source: "native" as const };
  const select = async (id: number) => {
    const result = await showInRevit({ ids: [id], scope }, true);
    if (result.kind === "action" && result.action.state === "succeeded") return;
    let message = result.message;
    try {
      await navigator.clipboard.writeText(String(id));
      message += ". Element id copied.";
    } catch {
      message += ". Clipboard unavailable.";
    }
    setSelectionMessage(message);
    return { message };
  };
  const anchor = (id: number) => (
    <Button
      label={`Select element ${id} in Revit`}
      {...revitTarget([id])}
      onPress={() => select(id)}
    >
      {id}
    </Button>
  );
  return (
    <NativeObservationScope value={{ scope }}>
      <div className="space-y-4 overflow-auto p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            label="Refresh fan roster"
            refusal={state.busy || state.loading ? "A read is running" : null}
            onClick={() => void state.refresh()}
          >
            refresh roster
          </Button>
          <Button
            label="Compute all fan ports"
            refusal={
              state.busy || state.loading
                ? "A read is running"
                : !state.rows.length
                  ? "No fan ports"
                  : null
            }
            onClick={() => void state.computeAll()}
          >
            compute all · {state.rows.length}
          </Button>
          {state.busy && (
            <Button label="Cancel computation" onClick={state.cancel}>
              cancel
            </Button>
          )}
          {state.loading && <span role="status">Reading fan roster…</span>}
          {state.progress && (
            <span role="status">
              {state.progress.stopped ? "Cancelled" : "Computed"} {state.progress.done} /{" "}
              {state.progress.total} {state.progress.mark}
            </span>
          )}
        </div>
        {state.error && (
          <p role="alert" data-tone="alarm">
            {state.error}
          </p>
        )}
        {selectionMessage && <p role="status">{selectionMessage}</p>}
        <Roster
          rows={state.rows}
          compute={(fan) => void state.compute(fan)}
          anchor={anchor}
          busy={state.busy || state.loading}
          loading={state.loading}
        />
        {state.busy && !state.progress && <p role="status">Reading fan sheet…</p>}
        {state.sheet ? (
          <FanSheet
            sheet={state.sheet}
            anchor={anchor}
            pickPath={(id) => void state.pickPath(id)}
            busy={state.busy}
            controls={
              <SheetInputs
                sheet={state.sheet}
                slots={state.slots}
                activeSlot={state.activeSlot}
                busy={state.busy}
                anchor={anchor}
                change={(inputs) => void state.changeInputs(inputs)}
                rule={(proposal) => void state.ruleProposal(proposal)}
              />
            }
            picture={
              <SheetPicture
                key={`${state.sheet.overview.fan?.unitId}:${state.sheet.overview.fan?.portIndex}`}
                sheet={state.sheet}
                select={(id) => void select(id)}
              />
            }
          />
        ) : (
          <p className="text-ink-2">Choose a fan port to open its pressure sheet.</p>
        )}
      </div>
    </NativeObservationScope>
  );
}

export function SheetRoute() {
  const [chosen] = useChooseTarget();
  const handle = useRoute(manifest, { target: chosen });
  const ladder = useDocumentLadder(handle);
  const target =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  return (
    <RegistryContext value={handle.registry}>
      <Surface
        head={
          <RouteShell
            manifest={manifest}
            handle={handle}
            aside={<LadderPicker ladder={ladder} />}
          />
        }
      >
        {target ? (
          <SheetWorkspace key={`${target.session}/${target.openId}`} target={target} />
        ) : (
          <p>Choose a session and document.</p>
        )}
      </Surface>
    </RegistryContext>
  );
}
