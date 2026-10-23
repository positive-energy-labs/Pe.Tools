import { TooltipHint } from "./tooltip";
import {
  Children,
  Component,
  Fragment,
  Suspense,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useState,
  type Key,
  type ReactNode,
} from "react";

import { createPortal } from "react-dom";
import { ButtonGroup } from "./button-group";

import { Floater, type FloaterSpec } from "./floater";
import { PaneStrip, type PaneStripProps } from "./pane-strip";
import { KeyScope, useDeclaredGestures } from "../../keys";
import { KeyLegend } from "./key-hint";
import { POINTER_WORD } from "./gesture-glyph";
import { Button } from "./button";
import { tv, type VariantProps } from "../../lib/tv";

import { Rail } from "./rail";
import { PaneCrumb } from "./pane-crumb";
import { useReachChannel } from "./reach";
import { SubjectBox } from "./popover";
import "./pane.css";

/** The renderer supplies geometry; the pane never knows a camera or a domain identity. */
export const PictureContext = createContext<{
  selected: boolean;
  box: () => DOMRect | null;
} | null>(null);
type ReadoutIdentity = { subject?: ReactNode; title?: ReactNode; onClear?: () => void };
export const PictureReadoutContext = createContext<
  ((identity: ReadoutIdentity) => () => void) | null
>(null);

const PaneFaultContext = createContext<((error: unknown) => void) | undefined>(undefined);
/** The application supplies its diagnostics sink once; kit has no host dependency. */
export function PaneFaultProvider({
  onFault,
  children,
}: {
  onFault: (error: unknown) => void;
  children: ReactNode;
}) {
  return <PaneFaultContext value={onFault}>{children}</PaneFaultContext>;
}
const PaneOverlayContext = createContext<HTMLElement | null | undefined>(undefined);
/** Nested furniture joins the pane field so floaters yield in one DOM order. */
export function PaneOverlay({
  label,
  place = "tl",
  children,
}: {
  label: string;
  place?: FloaterSpec["place"];
  children: ReactNode;
}) {
  const field = useContext(PaneOverlayContext);
  const overlay = (
    <Floater spec={{ key: label, label, place, open: true, render: () => children }} />
  );
  return field === undefined ? overlay : field ? createPortal(overlay, field) : null;
}
const hasContent = (node: ReactNode): boolean =>
  Children.toArray(node).some((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? hasContent(child.props.children)
      : child !== "",
  );

function PaneGestureLegend({
  host,
  children,
}: {
  host: React.RefObject<HTMLElement | null>;
  children?: ReactNode;
}) {
  const gestures = useDeclaredGestures().filter(
    (gesture) =>
      gesture.host &&
      host.current?.contains(gesture.host) &&
      gesture.host.closest("[data-slot='pane']") === host.current,
  );
  if (!gestures.length && children == null) return null;
  return (
    <PaneOverlay label="picture legend" place="bl">
      <div data-slot="pane-legend" className="flex flex-col items-start gap-1">
        {children}
        {gestures.length ? (
          <KeyLegend
            lead={0}
            keys={gestures.map(({ keys, pointer, label }) => ({
              keys,
              pointer: pointer && POINTER_WORD[pointer],
              does: label,
            }))}
          />
        ) : null}
      </div>
    </PaneOverlay>
  );
}

// A pane is a header, a scrolling body and an error boundary; it is also a key scope, so a child's
// `useScopeKeys` binds while focus is inside it. Empty chrome draws no header.
export const paneRecipe = tv({
  slots: {
    root: "relative flex size-full min-h-0 min-w-0 flex-col overflow-visible",
    // A column, so a call site docks a region under a scroller without a second scroller.
    body: "relative flex min-h-0 min-w-0 flex-1 flex-col",
  },
  variants: {
    scroll: {
      auto: { body: "overflow-auto" },
      clip: { body: "overflow-hidden" },
      visible: { body: "overflow-visible" },
    },
    flush: {
      false: { body: "p-(--gutter)" },
      true: { body: "p-0" },
    },
  },
  defaultVariants: { scroll: "auto", flush: false },
});

interface PaneProps extends VariantProps<typeof paneRecipe>, PaneStripProps {
  /** Corner furniture shares drag, shrink and yield with the pane floaters. */
  overlay?: ReactNode;
  id?: string;
  title?: ReactNode;
  /** The title is the thing shown (a thread, a schedule), drawn as the page heading. */
  name?: boolean;
  /** A short machine fact (a count, a mode word), truncated beside the title. Prose is `help`. */
  meta?: ReactNode;
  help?: ReactNode;
  actions?: ReactNode;
  leadingActions?: ReactNode;
  titleAlign?: "start" | "center";
  /** Pane-view tabs replace the title line; the title stays the accessible name. */
  tabs?: ReactNode;
  /** The pane's ground; the artifact plane draws its own hairline. Default: the page. */
  ground?: "artifact";
  /** Change it when the child changes target, so an old error cannot mask the new one. */
  boundaryKey?: Key;
  onRetry?: () => void;
  children: ReactNode;
}

type PicturePaneProps = PaneProps &
  ({ picture: true; legend: ReactNode } | { picture?: false; legend?: never });

export class PaneErrorBoundary extends Component<
  { children: ReactNode; what?: ReactNode; onRetry?: () => void },
  { failed: boolean; message: string }
> {
  static contextType = PaneFaultContext;
  declare context: React.ContextType<typeof PaneFaultContext>;
  state = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  // The pane boundary owns its fault; an inner boundary that caught first owns its own.
  componentDidCatch(error: unknown) {
    this.context?.(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-2">
        <span className="t-small" data-tone="alarm">
          {this.props.what ?? "pane"} failed to load
        </span>
        <span className="text-ink-2">{this.state.message}</span>
        <Button
          kind="framed"
          label="retry"
          onClick={() => {
            this.setState({ failed: false, message: "" });
            this.props.onRetry?.();
          }}
        >
          retry
        </Button>
      </div>
    );
  }
}

export function Pane({
  id,
  title,
  name = false,
  meta,
  help,
  actions,
  leadingActions,
  titleAlign = "start",
  tabs,
  scroll,
  flush,
  ground,
  boundaryKey,
  onRetry,
  modes,
  floaters,
  picture,
  legend,
  overlay,
  layers,
  children,
}: PicturePaneProps) {
  const { root, body } = paneRecipe({ scroll, flush });
  const rootRef = useRef<HTMLElement>(null);
  const stage = useContext(PictureContext);
  const reach = useReachChannel();
  const [identity, setIdentity] = useState<ReadoutIdentity>({});
  const register = useCallback((next: ReadoutIdentity) => {
    setIdentity(next);
    return () => setIdentity((was) => (was === next ? {} : was));
  }, []);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const pictureBox = useCallback(
    () => stageRef.current?.box() ?? rootRef.current?.getBoundingClientRect() ?? null,
    [],
  );
  // The channel also reaches sibling panes, whose popovers must clear this picture.
  useEffect(() => {
    if (!picture) return;
    reach.set((state) => ({ ...state, picture: pictureBox }));
    return () =>
      reach.set((state) =>
        state.picture === pictureBox ? { ...state, picture: null, hovered: null } : state,
      );
  }, [picture, reach, pictureBox]);
  const crumb = picture ? (
    <PaneCrumb
      segments={[
        ...(hasContent(title) ? [{ label: title }] : []),
        ...(hasContent(identity.subject)
          ? [{ label: identity.subject, onPress: identity.onClear }]
          : []),
        ...((stage?.selected ?? true) && hasContent(identity.title)
          ? [{ label: identity.title }]
          : []),
      ]}
    />
  ) : (
    title
  );
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const strip =
    (modes?.options.length ?? 0) > 0 ||
    (floaters?.length ?? 0) > 0 ||
    (layers?.options.length ?? 0) > 0 ? (
      <PaneStrip modes={modes} floaters={floaters} layers={layers} />
    ) : null;
  const heading = (
    <>
      {hasContent(tabs) ? (
        tabs
      ) : hasContent(title) ? (
        <h2 data-slot="pane-title" data-heading={name ? "name" : undefined}>
          {crumb}
        </h2>
      ) : null}
      {!hasContent(tabs) && hasContent(meta) && (
        <TooltipHint content={typeof meta === "string" ? meta : undefined}>
          <span className="face-mono t-small min-w-0 truncate text-ink-mute">{meta}</span>
        </TooltipHint>
      )}
      {hasContent(help) && (
        <span className="shrink-0 self-center">
          <TooltipHint>{help}</TooltipHint>
        </span>
      )}
    </>
  );
  const paneBody = (
    <div data-slot="pane-body" className={body()}>
      <PaneErrorBoundary key={boundaryKey} what={title} onRetry={onRetry}>
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="flex flex-1 items-center justify-center t-small text-ink-2"
            >
              {title != null ? <>loading {title}…</> : "loading…"}
            </div>
          }
        >
          {children}
        </Suspense>
      </PaneErrorBoundary>
    </div>
  );
  return (
    <PictureReadoutContext value={picture ? register : null}>
      <SubjectBox box={picture ? pictureBox : null}>
        <KeyScope id={id ?? "pane"} element={rootRef}>
          <section
            ref={rootRef}
            data-slot="pane"
            data-picture={picture || undefined}
            data-pane-id={id}
            data-surface={ground}
            aria-label={typeof title === "string" ? title : undefined}
            tabIndex={-1}
            // A click on inert content focuses the pane, so its scope's keys bind.
            onPointerDownCapture={(event) => {
              const focusable = (event.target as HTMLElement).closest<HTMLElement>(
                "a,button,input,select,textarea,[contenteditable='true'],[tabindex]",
              );
              if (!focusable || focusable === event.currentTarget)
                event.currentTarget.focus({ preventScroll: true });
            }}
            className={root()}
          >
            {[title, meta, actions, leadingActions, tabs, help, strip].some(hasContent) && (
              <div data-slot="pane-header" data-title-align={titleAlign} className="shrink-0">
                <Rail
                  lead={
                    <>
                      {leadingActions}
                      {titleAlign === "start" ? heading : null}
                    </>
                  }
                  center={titleAlign === "center" ? heading : undefined}
                  trail={
                    hasContent(actions) || strip != null ? (
                      <div data-slot="pane-actions" className="flex shrink-0 items-center">
                        {hasContent(actions) && <ButtonGroup>{actions}</ButtonGroup>}
                        {strip}
                      </div>
                    ) : undefined
                  }
                />
              </div>
            )}
            <PaneOverlayContext value={field}>
              <div
                ref={setField}
                data-slot="pane-field"
                className="relative flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {paneBody}
                {hasContent(overlay) ? (
                  <PaneOverlay label="pane overlay" place="tr">
                    {overlay}
                  </PaneOverlay>
                ) : null}
                {floaters?.map((spec) =>
                  spec.open ? <Floater key={spec.key} spec={spec} /> : null,
                )}
                <PaneGestureLegend host={rootRef}>{legend}</PaneGestureLegend>
              </div>
            </PaneOverlayContext>
          </section>
        </KeyScope>
      </SubjectBox>
    </PictureReadoutContext>
  );
}

export { PaneSplit } from "./pane-resize";
