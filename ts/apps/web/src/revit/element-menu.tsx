/**
 * The element menu: anything on any page that stands for Revit elements (a kit Row's `revitIds`,
 * or `revitTarget(ids)` spread on any element) answers right-click with Revit's own two verbs,
 * Selection Box and Select, and answers BX (Revit's Selection Box shortcut) under the pointer or
 * focus. One delegate at the root serves every surface; a surface only declares its ids.
 * Double-click stays free. The nearest displayed-observation scope is mandatory.
 */
import { useEffect, useRef, useState } from "react";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { KeyHint } from "@pe/kit/lang/key-hint";
import { Button } from "@pe/kit/lang/button";
import { FactChip } from "@pe/kit/lang/chip";
import { revitTarget } from "@pe/kit/lang/row";
import { submitAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import {
  elementTargetOf as targetOf,
  prepareElements,
  prepareFamilyPlacements,
  showElementsMessage,
  revitScope,
  type ElementTarget as Target,
  type ShowElementsResult,
} from "./element-target";
import { readFamilyPlacements } from "./observation";
export { revitScope } from "./element-target";
export type { ShowElementsResult } from "./element-target";

/** Box: select and section-box the {3D} view, then zoom to fit. Select: select only. */
export async function showInRevit(
  target: Target,
  selectOnly: boolean,
): Promise<ShowElementsResult> {
  let prepared = prepareElements(target, selectOnly);
  if (prepared.kind === "refused") return prepared;
  try {
    if (prepared.kind === "family") {
      const captured = prepared;
      const scope = captured.scope;
      const reading = await readFamilyPlacements(captured.request, captured.document);
      if (reading.kind === "refused") return reading;
      if (!target.isCurrent?.())
        return {
          kind: "refused",
          code: "ObservationChanged",
          message:
            "The displayed family reading changed while placements were resolving; nothing was selected or boxed.",
        };
      prepared = prepareFamilyPlacements(reading.data, captured.request, scope, selectOnly);
      if (prepared.kind !== "ready")
        return prepared.kind === "refused"
          ? prepared
          : {
              kind: "refused",
              code: "FamilyResolutionIncomplete",
              message: "No concrete placements were resolved.",
            };
    }
    const action = await submitAction(
      {
        id: crypto.randomUUID(),
        kind: "operation",
        key: "revit.context.show-elements",
        destination: { kind: "document", ref: prepared.document },
        input: { ...prepared.request },
        bases: {},
      },
      "",
      30_000,
    );
    const data =
      action.state === "succeeded" && "result" in action
        ? (action.result as import("@pe/host-contracts/operation-types").OpResponseOf<"revit.context.show-elements">)
        : null;
    return {
      kind: "action",
      action,
      data,
      message: `Revit action ${action.id}: ${action.state}${"error" in action ? `: ${action.error}` : ""}`,
    };
  } catch (error) {
    return {
      kind: "failed",
      error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const VERBS = [
  { key: "box", label: "Selection Box", keys: "BX", selectOnly: false },
  { key: "select", label: "Select", keys: null, selectOnly: true },
] as const;

const typing = (el: Element | null) =>
  !!el?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");

export function ElementMenu() {
  const [menu, setMenu] = useState<(Target & { x: number; y: number }) | null>(null);
  const count = menu
    ? new Set([...menu.ids, ...(menu.refs ?? []).map((ref) => ref.elementId)]).size
    : 0;
  const subject = menu?.family
    ? "current placements across all family types"
    : `${count} element(s)`;
  const [said, setSaid] = useState<{ text: string; x: number; y: number } | null>(null);
  const caret = useRef<HTMLSpanElement>(null);
  // The answer stands by the pointer: what Revit did, or why it refused.
  const run = (target: Target, selectOnly: boolean, x: number, y: number) => {
    setSaid({ text: selectOnly ? "selecting…" : "boxing…", x, y });
    void showInRevit(target, selectOnly).then((result) =>
      setSaid({ text: showElementsMessage(result), x, y }),
    );
  };

  useEffect(() => {
    let pointer: Element | null = null;
    let at = { x: 0, y: 0 };
    let armed: number | null = null;
    const onMenu = (event: MouseEvent) => {
      // A surface with its own menu (a thread row) already took the press.
      if (event.defaultPrevented) return;
      const target = targetOf(event.target as Element);
      if (!target) return;
      event.preventDefault();
      setMenu({ ...target, x: event.clientX, y: event.clientY });
    };
    const onOver = (event: PointerEvent) => {
      pointer = event.target as Element;
      at = { x: event.clientX, y: event.clientY };
    };
    const onKey = (event: KeyboardEvent) => {
      // A right-click leaves focus on the page, so the popup's own Escape never hears it.
      if (event.key === "Escape") return setMenu(null);
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        typing(document.activeElement)
      ) {
        armed = null;
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "b") {
        armed = event.timeStamp;
        return;
      }
      // Revit reads a two-letter shortcut typed within a beat; so does this.
      const wasArmed = armed;
      armed = null;
      if (key !== "x" || wasArmed === null || event.timeStamp - wasArmed > 1500) return;
      const target =
        targetOf(pointer?.isConnected ? pointer : null) ?? targetOf(document.activeElement);
      if (!target) return;
      event.preventDefault();
      run(target, false, at.x, at.y);
    };
    document.addEventListener("contextmenu", onMenu);
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", onMenu);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("keydown", onKey);
    };
    // run only calls a state setter, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!said || said.text.endsWith("…")) return;
    const id = setTimeout(() => setSaid(null), 4000);
    return () => clearTimeout(id);
  }, [said]);

  return (
    <>
      <span
        ref={caret}
        aria-hidden
        className="pointer-events-none fixed size-px"
        style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
      />
      {menu ? (
        <ListPopup<(typeof VERBS)[number]>
          // The positioner tracks its anchor's scroll and size, not a moved caret: each open mounts anew.
          key={`${menu.x},${menu.y}`}
          anchor="caret"
          purpose="menu"
          caret={caret.current}
          open
          onOpenChange={(next) => {
            if (!next) setMenu(null);
          }}
          aria-label={`Revit ${subject}`}
          items={VERBS}
          keyOf={(verb) => verb.key}
          labelOf={(verb) => verb.label}
          filter="none"
          select="single"
          empty="no verbs"
          row={(verb) => ({
            label: verb.label,
            title:
              verb.key === "box"
                ? `select ${subject}, box the {3D} view around them and zoom to fit; no model element changes`
                : `select ${subject} in Revit; the view stays as it is`,
            meta: verb.keys ? <KeyHint>{verb.keys}</KeyHint> : undefined,
          })}
          onPick={(verb) => {
            setMenu(null);
            run(menu, verb.selectOnly, menu.x, menu.y);
          }}
        />
      ) : null}
      {said ? (
        <span
          role="status"
          data-element-menu-said=""
          data-surface="artifact"
          className="t-small border-line fixed z-50 max-w-80 rounded-sm border px-1.5 py-0.5 text-ink-2 shadow-sm"
          style={{ left: said.x + 12, top: said.y + 12 }}
        >
          {said.text}
        </span>
      ) : null}
    </>
  );
}

/**
 * The one visible door, for a surface whose selection must offer Revit in plain sight (the
 * selection strip): Selection Box, its answer beside it, and the BX it teaches.
 */
export function SelectionBoxButton({ target }: { target: Target }) {
  const [result, setResult] = useState<ShowElementsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const prepared = prepareElements(target, false);
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1"
      {...revitScope(target.scope)}
      {...revitTarget(target.ids, target.refs)}
    >
      <Button
        kind="framed"
        busy={busy}
        refusal={prepared.kind === "refused" ? prepared.message : null}
        label="Selection Box: box the {3D} view around it in Revit (right-click or BX anywhere)"
        onClick={() => {
          setResult(null);
          setBusy(true);
          void showInRevit(target, false)
            .then(setResult)
            .finally(() => setBusy(false));
        }}
      >
        Selection Box <KeyHint>BX</KeyHint>
      </Button>
      {result ? (
        <FactChip title="what revit.context.show-elements answered">
          {showElementsMessage(result)}
        </FactChip>
      ) : null}
    </span>
  );
}
