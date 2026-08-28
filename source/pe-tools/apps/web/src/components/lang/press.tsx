/**
 * PRESS — the neutral machinery control: a tab, a disclosure, a sort header, a close ×.
 * `Verb` is the control that ACTS and owns the tone budget; `Press` mints no tone and draws no
 * layout (the call site keeps its own padding, ground and type). A control that has earned a
 * tone is a `Verb`, not a dressed-up `Press`.
 *
 * Invariants it owns: a real `<button>` (Enter/Space, role, form participation); `type`
 * defaulted to `"button"` so a control inside a form is never an accidental submit; the ONE
 * HOVER LAW's veil, focus ring and `not-allowed` disabled cursor via `.dl-press` in lang.css;
 * and pass-through of `ref`, handlers, `disabled` and aria — nothing here intercepts them.
 *
 * The ground/type/border reset stays OUT of `.dl-press`: lang.css is unlayered and would beat
 * the call site's own utilities.
 */
import { cn } from "#/lib/utils";

import "./lang.css";

export type PressProps = React.ComponentProps<"button">;

export function Press({ className, type, ...props }: PressProps) {
  return <button type={type ?? "button"} className={cn("dl-press", className)} {...props} />;
}
