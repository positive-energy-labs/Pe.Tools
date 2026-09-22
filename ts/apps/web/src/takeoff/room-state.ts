import { token } from "#/lib/token";
import { VERDICT_INK } from "#/components/master-table/cells";
import type { Verdict as RowVerdict, VerdictTone } from "#/components/master-table/model";
import { ATLAS_ROOM_STATE_LABEL, type AtlasRoomState as RoomState } from "#/takeoff/controller";
import type { Phase } from "#/takeoff/world";

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

export const stateInk = (state: RoomState): string => VERDICT_INK[STATE_META[state].tone];

export const stateMeta = (state: RoomState): RowVerdict => ({
  word: STATE_META[state].label,
  tone: STATE_META[state].tone,
  note: STATE_META[state].note,
  dim: state === "unreviewed",
});

export const STAGE_BLURB: Record<Phase, string> = {
  declared: "adopted, no system tag typed",
  registered: "tag resolved against the registry",
  partitioned: "rooms materialized, decisions open",
  reviewed: "decision queue empty",
  data: "Manual J data entered, not exported",
  synced: ".r10 in sync",
  drifted: "hand-edit drift since last sync",
};

export const CURSOR_INK = token("ink");

export const ABSENT_INK = token("ink-mute");

export {
  ATLAS_ROOM_STATES as ROOM_STATES,
  type AtlasRoomState as RoomState,
} from "#/takeoff/controller";
