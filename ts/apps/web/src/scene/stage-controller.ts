import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { chordLabel, useScopeGestures, useScopeKeys, type ScopeKey } from "@pe/kit/keys";
import type { PlaneViewport } from "@pe/agent-contracts";
import { clearPose, subjectPose, type PictureBounds } from "./framing";
import { ORBIT_GESTURES } from "./gestures";
import { flyTo, glideLook, type LiveOrbit } from "@pe/kit/lang/live-orbit";
import { applyLook, center, frame, type OrbitViewport } from "./orbit";
import type { Bounds } from "./types";
import { useViewHistory } from "./view-history";
import type { Bounds2 } from "#/lib/affine-frame";
import type { usePlaneViewport } from "./use-plane-viewport";

type HistoryMove = { history: "push" | "replace" };
/** The only translation from a released camera move to address history. */
export const stageViewport =
  <V extends OrbitViewport | PlaneViewport>(
    publish: (next: { viewport: V }, move: HistoryMove) => void,
  ) =>
  (viewport: V, how: "gesture" | "move") =>
    publish({ viewport }, { history: how === "gesture" ? "replace" : "push" });

type Common = {
  host: HTMLElement | null;
  clearSelection: () => void;
  onHistoryStep?: () => void;
};
type OrbitStage = Common & {
  kind: "orbit";
  orbit: LiveOrbit;
  bounds: PictureBounds | null;
  selectedBounds: Bounds | null;
  /** An orthographic axis retains its return pose and fit-only framing. */
  axis?: { label: string; escape: () => void; frame: () => void } | null;
};
type PlaneStage = Common & {
  kind: "plane";
  viewport: ReturnType<typeof usePlaneViewport>;
  bounds: Bounds2 | null;
  selectedBounds: Bounds2 | null;
};

/** Selection is input to the pivot only. Only these named verbs may move a stage. */
function useStageBindings(options: OrbitStage | PlaneStage) {
  const go = useViewHistory(options.onHistoryStep);
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  const poseOf = (target: Bounds | null) => {
    if (options.kind !== "orbit" || !options.bounds) return null;
    const { bounds, host, orbit } = options;
    const rect = host?.getBoundingClientRect();
    const aspect = rect?.height ? rect.width / rect.height : 1;
    const view = target
      ? subjectPose(bounds, target, orbit.read(), aspect)
      : frame(bounds.scene, bounds.subject, undefined, aspect);
    return host ? clearPose(view, target ?? bounds.subject, bounds.scene, host) : view;
  };
  const frameOn = (target: Bounds | null) => {
    if (options.kind === "plane") {
      const box = options.selectedBounds ?? options.bounds;
      const next = box && options.viewport.frame(box, options.selectedBounds ? 48 : 0);
      if (next) options.viewport.move(next, "move");
      return;
    }
    if (options.axis) return options.axis.frame();
    const pose = poseOf(target);
    if (pose) flyTo(options.orbit, pose, { scene: options.bounds?.scene });
  };
  const keys: ScopeKey[] = [
    {
      hotkey: "F",
      label: "frame",
      says: "Frame the selection; with nothing selected, fit the picture",
      callback: () => frameOn(options.kind === "orbit" ? options.selectedBounds : null),
    },
    ...(options.kind === "orbit"
      ? ([
          {
            hotkey: "P",
            label: "plan or isometric",
            says: "Look down or isometric, keeping pivot and zoom",
            available: () => !options.axis,
            callback: () => {
              const now = options.orbit.read();
              if (now)
                flyTo(options.orbit, applyLook(now.elev >= 89 ? "iso" : "plan", now), {
                  scene: options.bounds?.scene,
                });
            },
          },
          {
            hotkey: "N",
            label: "look north",
            says: "Look north, keeping elevation, pivot and zoom",
            available: () => !options.axis,
            callback: () => {
              glideLook(options.orbit);
            },
          },
        ] satisfies ScopeKey[])
      : []),
  ];
  const escape: ScopeKey = {
    hotkey: "Escape",
    label: options.kind === "orbit" && options.axis ? options.axis.label : "clear the selection",
    callback: () => {
      if (options.kind === "orbit" && options.axis) options.axis.escape();
      else options.clearSelection();
    },
    options: { conflictBehavior: "allow" },
  };
  useScopeKeys(keys);
  useScopeKeys([escape], body);
  useEffect(() => {
    if (options.kind !== "plane" || !options.host) return;
    const frame = () => frameOn(null);
    options.host.addEventListener("dblclick", frame);
    return () => options.host?.removeEventListener("dblclick", frame);
  }, [options]);
  useScopeGestures(
    [
      ...(options.kind === "orbit" ? ORBIT_GESTURES : []),
      ...keys
        .filter((key) => key.available?.() !== false)
        .map((key) => ({ keys: [chordLabel(key.hotkey)], label: key.says ?? key.label })),
      { keys: ["Esc"], label: escape.label },
      { keys: ["Alt", "← / →"], label: "back / forward (also mouse buttons 3 / 4)" },
    ],
    options.host,
  );
  return {
    frameOn,
    poseOf,
    go,
    orbitPivot:
      options.kind === "orbit" && options.selectedBounds ? center(options.selectedBounds) : null,
  };
}

const StageContext = createContext<ReturnType<typeof useStageBindings> | null>(null);

/** The picture host supplies its state once; every nested part gets the same verbs. */
export function PictureStage({
  children,
  ...picture
}: (OrbitStage | PlaneStage) & {
  children: ReactNode | ((stage: NonNullable<ReturnType<typeof useStage>>) => ReactNode);
}) {
  const stage = useStageBindings(picture);
  return createElement(
    StageContext,
    { value: stage },
    typeof children === "function" ? children(stage) : children,
  );
}

/** The picture owns the bindings; consumers only read its verbs. */
export function useStage() {
  const stage = useContext(StageContext);
  if (!stage) throw new Error("useStage requires a PictureStage");
  return stage;
}
