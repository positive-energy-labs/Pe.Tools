import { token } from "#/lib/token";
import { VERDICT_INK } from "#/components/master-table/cells";
import type { Verdict as RowVerdict, VerdictTone } from "#/components/master-table/model";
import { ATLAS_ROOM_STATE_LABEL, type AtlasRoomState as RoomState } from "#/takeoff/store";
import type { Stage } from "#/takeoff/world";

export const STATE_META: Record<RoomState, { tone: VerdictTone; label: string; note: string }> = {
  call: {
    tone: "alarm",
    label: ATLAS_ROOM_STATE_LABEL.call,
    note: "a human must decide: an open detector flag, or the .r10 no longer matches the model",
  },
  unreviewed: {
    tone: "mute",
    label: ATLAS_ROOM_STATE_LABEL.unreviewed,
    note: "nothing open, but no Manual J data entered yet — export would refuse this room",
  },
  data: {
    tone: "caution",
    label: ATLAS_ROOM_STATE_LABEL.data,
    note: "Manual J data entered against settled geometry, not yet exported — unsaved",
  },
  synced: {
    tone: "done",
    label: ATLAS_ROOM_STATE_LABEL.synced,
    note: "exported and the .r10 still agrees with the model",
  },
};

/** The CSS ink behind a room state — for the SVG plan fills and rail bars, which cannot take
 * a tone name. One derivation, so the three surfaces cannot diverge. */
export const stateInk = (state: RoomState): string => VERDICT_INK[STATE_META[state].tone];

/** The one alarm is `call` (tone carries it); `unreviewed` is the one dim. */
export const stateMeta = (state: RoomState): RowVerdict => ({
  word: STATE_META[state].label,
  tone: STATE_META[state].tone,
  note: STATE_META[state].note,
  dim: state === "unreviewed",
});

export const STAGE_BLURB: Record<Stage, string> = {
  declared: "adopted, no system tag typed",
  registered: "tag resolved against the registry",
  partitioned: "rooms materialized, decisions open",
  reviewed: "decision queue empty",
  data: "Manual J data entered, not exported",
  synced: ".r10 in sync",
  drifted: "hand-edit drift since last sync",
};

/**
 * SELECTION AND FOCUS ARE A FILL, NEVER A HUE. The plan used the commit role, the one
 * filled blue, reserved for writes that leave the page) as its cursor mark, which spent the commit
 * colour on "where am I". The legal fill — `--pe-select` — is a page-adjacent ground and disappears
 * as an SVG stroke over the designer's own zone colours, so the cursor is drawn in NEUTRAL INK
 * instead: no hue bought, and still the highest-contrast mark on the plan.
 */
export const CURSOR_INK = token("ink");

/** Held residue and the "no boundary" fallback both mean "nothing real is here". */
export const ABSENT_INK = token("ink-mute");

/**
 * Per-zone progress, derived: one equal segment per room, coloured by that room's own state. A
 * zone with no rooms gets an empty outlined bar — "not partitioned" is a real state, not a zero.
 * This replaces the seven-tick zone-stage pip, which said nothing about whether work was needed.
 *
 * The empty bar used a DASHED edge, which the language reserves for SEAM (a fixture/stand-in). An
 * unpartitioned zone is not a stand-in — it is a genuine empty — so it takes the firm hairline.
 */

export {
  ATLAS_ROOM_STATES as ROOM_STATES,
  type AtlasRoomState as RoomState,
} from "#/takeoff/store";
