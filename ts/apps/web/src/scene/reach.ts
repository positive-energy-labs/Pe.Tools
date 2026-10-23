import { useContext } from "react";
import { useReachSetter, useReachState } from "@pe/kit/lang/reach";
import { SubjectTextContext } from "@pe/kit/lang/subject-text";

/** Props remain usable in isolated pictures; a mounted subject scope is the authority. */
export function useSceneReach(fallback?: {
  hovered: number | null;
  onHover: (id: number | null) => void;
}) {
  const channel = useContext(SubjectTextContext)?.reach;
  const hovered = useReachState(channel, (state) => state.hovered);
  const set = useReachSetter();
  return {
    hovered: channel ? hovered : (fallback?.hovered ?? null),
    onHover: channel ? set : (fallback?.onHover ?? set),
  };
}
