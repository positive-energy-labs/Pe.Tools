/**
 * React doors onto the Revit facsimile. The spec, the renderer, `diff` and `set` live in
 * `revit.js` (one source: pages load the same file at /pages/revit.js). These wrappers only
 * hand its HTML to React.
 */
import { compare, render } from "./revit.js";
import type { Note, Spec } from "./revit.js";

export { diff, set } from "./revit.js";
export type { Change, Dialog, Note, Palette, Piece, Ribbon, Spec, Task } from "./revit.js";

/** One Revit window from its spec, with optional anchored notes. */
export function Revit(props: { spec: Spec; notes?: Note[] }) {
  return (
    <div
      className="contents"
      dangerouslySetInnerHTML={{ __html: render(props.spec, { notes: props.notes }) }}
    />
  );
}

/** Two states of one window side by side, every difference ringed and listed. */
export function RevitCompare(props: {
  a: Spec;
  b: Spec;
  notes?: Note[];
  labels?: [string, string];
}) {
  return (
    <div
      className="contents"
      dangerouslySetInnerHTML={{
        __html: compare(props.a, props.b, { notes: props.notes, labels: props.labels }),
      }}
    />
  );
}
