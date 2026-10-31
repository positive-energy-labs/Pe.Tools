import { useAtomValue } from "@effect/atom-react";
import { AttentionDocument, picture as pictureAtom } from "./attention";
import { Popover as Primitive } from "@base-ui/react/popover";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "../../lib/utils";

export const floatingSurface =
  "max-h-(--available-height) overflow-y-auto overscroll-contain t-small text-ink float-surface outline-none";
export type FloatingPosition = Pick<
  Primitive.Positioner.Props,
  "side" | "align" | "sideOffset" | "alignOffset"
>;

const Subject = createContext<DOMRect | RefObject<Element | null> | (() => DOMRect | null) | null>(
  null,
);
/** The picture, row or bar supplies its box once, without overlay-specific props. */
export function SubjectBox({
  box,
  children,
}: {
  box: DOMRect | RefObject<Element | null> | (() => DOMRect | null) | null;
  children: ReactNode;
}) {
  return <Subject.Provider value={box}>{children}</Subject.Provider>;
}
const Anchor = createContext<{
  element: Element | null;
  set: (node: Element | null) => void;
} | null>(null);
const Facing = createContext<Side>("bottom");
export const usePopoverSide = () => useContext(Facing);
/** One shown overlay, as the stack knows it: how to close it, its popup, and what it opened from. */
type Overlay = {
  close: (event?: KeyboardEvent) => void;
  popup: RefObject<Element | null>;
  anchor: RefObject<Element | null>;
};
/**
 * The open overlays, outermost first. Opening a popover closes every shown overlay that does not
 * contain its anchor, so siblings still replace each other, and a popover whose trigger sits inside
 * another's popup stacks on it instead. DOM containment is the test, not React ancestry: a route
 * portals its settings section into the chrome Settings popover (`RouteControlsOutlet`), so Base
 * UI's context-based nesting never sees that child (2026-10-27, the Ducts airflow slot picker closed
 * the Settings popover on open).
 */
const overlays: Overlay[] = [];
const Own = createContext<Pick<Overlay, "popup" | "anchor"> | null>(null);
const descendantHolds = (own: Overlay, node: unknown) =>
  node instanceof Node &&
  overlays.slice(overlays.indexOf(own) + 1).some((o) => o.popup.current?.contains(node));

export function Popover({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  actionsRef,
  ...props
}: Primitive.Root.Props) {
  const localActions = useRef<Primitive.Root.Actions>(null);
  const actions = actionsRef ?? localActions;
  const escapeEvent = useRef<KeyboardEvent | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [anchor, setAnchor] = useState<Element | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const popup = useRef<Element | null>(null);
  const anchorRef = useRef<Element | null>(null);
  const own = useRef<Overlay>({
    close: () => {},
    popup,
    anchor: anchorRef,
  }).current;
  const requested = controlled ?? open;
  const shown = requested && !dismissed;
  useEffect(() => {
    if (!requested) setDismissed(false);
  }, [requested]);
  useEffect(() => {
    if (!shown) return;
    own.close = (event?: KeyboardEvent) => {
      setDismissed(true);
      escapeEvent.current = event ?? null;
      actions.current?.close();
    };
    // Close from the top down until an overlay holds this one's anchor; that one is the parent.
    while (overlays.length && !overlays.at(-1)!.popup.current?.contains(anchorRef.current))
      overlays.pop()!.close();
    overlays.push(own);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || overlays.at(-1) !== own) return;
      // An editor inside the popup owns its local Escape before the popup consumes it.
      if (
        event.target instanceof Element &&
        event.target.closest(
          '[data-slot="popover-content"], [data-slot="hover-card-content"], [role="combobox"][aria-expanded="true"]',
        )
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      own.close(event);
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      const at = overlays.indexOf(own);
      if (at >= 0) overlays.splice(at, 1);
    };
  }, [shown, actions, own]);
  return (
    <Anchor.Provider value={{ element: anchor, set: setAnchor }}>
      <Own.Provider value={own}>
        <Primitive.Root
          {...props}
          open={shown}
          actionsRef={actions}
          onOpenChange={(next, details) => {
            if (escapeEvent.current) {
              details.reason = "escape-key";
              details.event = escapeEvent.current;
              escapeEvent.current = null;
            }
            // A press or focus landing in a stacked child's popup is inside this one.
            if (
              !next &&
              (details.reason === "outside-press" || details.reason === "focus-out") &&
              (descendantHolds(own, details.event?.target) ||
                descendantHolds(own, (details.event as FocusEvent | undefined)?.relatedTarget))
            ) {
              details.cancel();
              return;
            }
            onOpenChange?.(next, details);
            if (details.isCanceled) return;
            if (next) setDismissed(false);
            setAnchor(details.trigger ?? null);
            setOpen(next);
          }}
        />
      </Own.Provider>
    </Anchor.Provider>
  );
}
export function PopoverTrigger({
  className,
  kind,
  ref,
  ...props
}: Primitive.Trigger.Props & { kind?: "quiet" | "framed" }) {
  const setAnchor = useContext(Anchor)?.set;
  const attach = useCallback(
    (node: HTMLButtonElement | null) => {
      setAnchor?.(node);
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    },
    [ref, setAnchor],
  );
  return (
    <Primitive.Trigger
      ref={attach}
      data-kind={kind}
      className={(state) =>
        cn(
          "dl-button",
          kind === "framed" && "dl-control",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}
export const PopoverClose = Primitive.Close;
export const PopoverTitle = Primitive.Title;
export const PopoverDescription = Primitive.Description;

export type PopoverContentProps = Omit<Primitive.Popup.Props, "className"> &
  FloatingPosition & {
    className?: string;
    anchor?: Primitive.Positioner.Props["anchor"];
    collisionAvoidance?: Primitive.Positioner.Props["collisionAvoidance"];
    collisionPadding?: Primitive.Positioner.Props["collisionPadding"];
    collisionBoundary?: Primitive.Positioner.Props["collisionBoundary"];
    positionerClassName?: string;
    /** Keep the popup mounted while closed (a menu whose state outlives its opening). */
    keepMounted?: boolean;
    /** Mount the popup inside this node instead of the body (a control that owns its outcome). */
    container?: HTMLElement | null;
    /** Reverse a marked row stack above its anchor; children can read usePopoverSide. */
    facing?: boolean;
  };

type Side = NonNullable<FloatingPosition["side"]>;
/** Choosing a separating half-plane keeps any popup size off an exterior subject. */
export function sideAwayFrom(anchor: DOMRect, subject: DOMRect): Side {
  const gaps = [
    anchor.top - subject.bottom,
    subject.top - anchor.bottom,
    anchor.left - subject.right,
    subject.left - anchor.right,
  ];
  if (Math.max(...gaps) >= 0)
    return (["bottom", "top", "right", "left"] as const)[gaps.indexOf(Math.max(...gaps))]!;
  const dx = anchor.left + anchor.width / 2 - (subject.left + subject.width / 2);
  const dy = anchor.top + anchor.height / 2 - (subject.top + subject.height / 2);
  return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "top" : "bottom") : dx < 0 ? "left" : "right";
}

export function useSubjectPosition(anchor: Element | null) {
  const subject = useContext(Subject);
  const doc = useContext(AttentionDocument) ?? "";
  const picture = useAtomValue(pictureAtom(doc)).box;
  const source = subject ?? picture;
  const box =
    typeof source === "function"
      ? source()
      : source && "current" in source
        ? source.current?.getBoundingClientRect()
        : source;
  if (!box || !anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const side = sideAwayFrom(rect, box);
  const offset = {
    top: rect.top - box.top,
    bottom: box.bottom - rect.bottom,
    left: rect.left - box.left,
    right: box.right - rect.right,
  }[side as "top" | "bottom" | "left" | "right"];
  return { side, offset: Math.max(0, offset) };
}

/** Portal owns lazy mounting; closed children do not render or run effects. */
export function PopoverContent({
  side = "bottom",
  align = "start",
  sideOffset = 6,
  alignOffset = 0,
  anchor,
  collisionAvoidance,
  collisionPadding = 8,
  collisionBoundary,
  positionerClassName,
  className,
  keepMounted,
  container,
  facing,
  onKeyDown,
  ...props
}: PopoverContentProps) {
  const trigger = useContext(Anchor)?.element;
  const target =
    typeof Element !== "undefined" && anchor instanceof Element
      ? anchor
      : anchor && typeof anchor === "object" && "current" in anchor
        ? anchor.current
        : (trigger ?? null);
  const own = useContext(Own);
  if (own) own.anchor.current = target;
  const subject = useSubjectPosition(target);
  // L2: bounded furniture stays in its own field; subject overlays still clear the picture.
  const away = collisionBoundary ? null : subject;
  return (
    <Primitive.Portal keepMounted={keepMounted} container={container ?? undefined}>
      <Primitive.Positioner
        positionMethod="fixed"
        anchor={anchor}
        side={away?.side ?? side}
        align={align}
        sideOffset={
          typeof sideOffset === "function"
            ? (data) => sideOffset(data) + (away?.offset ?? 0)
            : sideOffset + (away?.offset ?? 0)
        }
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        collisionBoundary={collisionBoundary}
        collisionAvoidance={away ? { side: "none", align: "shift" } : collisionAvoidance}
        className={cn("isolate z-popup", positionerClassName)}
      >
        <Primitive.Popup
          data-facing={facing || undefined}
          data-surface="artifact"
          data-slot="popover-content"
          className={cn(floatingSurface, "w-80 max-w-(--available-width) p-3", className)}
          {...props}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.key !== "Escape") return;
            event.stopPropagation();
            if (!event.defaultPrevented) overlays.at(-1)?.close(event.nativeEvent);
          }}
          render={(popupProps, state) => (
            <div
              {...popupProps}
              ref={(node) => {
                if (own) own.popup.current = node;
                const { ref } = popupProps as { ref?: React.Ref<HTMLDivElement> };
                if (typeof ref === "function") return ref(node);
                if (ref) ref.current = node;
              }}
            >
              <Facing.Provider value={state.side}>{props.children}</Facing.Provider>
            </div>
          )}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
