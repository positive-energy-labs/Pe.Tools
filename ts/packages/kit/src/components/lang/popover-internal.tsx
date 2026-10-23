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
import { SubjectTextContext, useReachState } from "./reach";

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
let overlay: { close: (event?: KeyboardEvent) => void } | null = null;

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
  const requested = controlled ?? open;
  const shown = requested && !dismissed;
  useEffect(() => {
    if (!requested) setDismissed(false);
  }, [requested]);
  useEffect(() => {
    if (!shown) return;
    const own = {
      close: (event?: KeyboardEvent) => {
        setDismissed(true);
        escapeEvent.current = event ?? null;
        actions.current?.close();
      },
    };
    if (overlay !== own) overlay?.close();
    overlay = own;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || overlay !== own) return;
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
      if (overlay === own) overlay = null;
    };
  }, [shown, actions]);
  return (
    <Anchor.Provider value={{ element: anchor, set: setAnchor }}>
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
          onOpenChange?.(next, details);
          if (details.isCanceled) return;
          if (next) setDismissed(false);
          setAnchor(details.trigger ?? null);
          setOpen(next);
        }}
      />
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
    positionerClassName?: string;
    /** Keep the popup mounted while closed (a menu whose state outlives its opening). */
    keepMounted?: boolean;
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
  const picture = useReachState(useContext(SubjectTextContext)?.reach, (state) => state.picture);
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
  positionerClassName,
  className,
  keepMounted,
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
  const away = useSubjectPosition(target);
  return (
    <Primitive.Portal keepMounted={keepMounted}>
      <Primitive.Positioner
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
            if (!event.defaultPrevented) overlay?.close(event.nativeEvent);
          }}
          render={(popupProps, state) => (
            <div {...popupProps}>
              <Facing.Provider value={state.side}>{props.children}</Facing.Provider>
            </div>
          )}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
