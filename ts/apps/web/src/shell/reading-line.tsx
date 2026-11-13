import { OutcomeLine } from "@pe/kit/lang/outcome";
import type { ReadingState } from "@pe/agent-contracts";
import { reasonOf, type Absent } from "../route/typed-route";

/** The shell's one line for a value-less reading (routes CONTRACTS.md, "Reading state"): reading, refused,
 *  or not yet run. Every pane, the subject and a body's second reading draw this same line. */
export function absentLine(state: Absent, label = "Reading") {
  return <div data-reading={state.state}><OutcomeLine kind={state.state === "reading" ? "busy" : state.state === "refused" ? "refused" : "advisory"} label={label} says={reasonOf(state)} /></div>;
}

/** A basis that failed (a Work feed failure) is damage on the pane it starves (I2): the one failure line. */
export const failureLine = (says: string) => <OutcomeLine kind="error" label="Reading failed" says={says} />;

/** The shell's overlay words for a present value that is not current; null for a ready or value-less state. */
export const retainedLine = (state: ReadingState<unknown>) =>
  state.state === "refreshing" ? "Showing previous Value; refreshing" : state.state === "stale" ? "Showing previous Value; refresh needed" : null;
