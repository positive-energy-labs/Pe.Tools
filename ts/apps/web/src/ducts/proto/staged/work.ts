/**
 * TEST-ONLY IMITATION (protoui round 1). Not Pea's output: hand-authored Work documents that imitate
 * what `ducts.propose` would write for two cases on the real Chadds snapshot
 * (`.artifacts/proto/ducts-r1/real/snapshot.json`, read 2026-10-20), so the variant lineup has
 * claims and joins with verbs to judge. Every cell is a `proposal` (no verdicts) whose `note` says
 * so. Topology and intent only: no airflow, pressure, size or rating is stated here. Ids, walk
 * order, connector directions and the two gaps were read from the snapshot by script; `work.test.ts`
 * holds every id to it.
 *
 * - `g8745870` (SA 19, FC-17 side): FC-17 9668311 to terminal 8745870, the longest of the group's
 *   five terminal walks by duct length. SA 19 also names g8747301 (FC-35, DH-30) and g8747668.
 * - `g14122436` (MUAS-1 to FC-23, across FA 50 / FA 43 / FA 44 / FA 27 / FA 20 / RA 37 / RA 114):
 *   louver 14088043 through MUAS-1 14577391 to FC-23 13760867, the walk Pea traced on 2026-10-17
 *   with the three elements between FR-1 and FC-23 put back. Keyed by MUAS-1's supply-side group.
 */
import { type DuctClaim, type DuctsRouteDocument, ductsDocumentSchema } from "@pe/agent-contracts";

const NOTE =
  "TEST-ONLY IMITATION: authored by hand to stand in for a Pea proposal; not Pea's output.";

/** Cells as `ducts.propose` writes them: proposals only, every one labelled an imitation. */
const work = (subject: number[], claims: Record<string, DuctClaim>): DuctsRouteDocument =>
  ductsDocumentSchema.parse({
    subject: { proposal: { value: subject, note: NOTE, confidence: "low" } },
    claims: Object.fromEntries(
      Object.entries(claims).map(([id, value]) => [
        id,
        { proposal: { value, note: NOTE, confidence: "low" } },
      ]),
    ),
  });

const SA19_SUBJECT = [
  9668311, 13509856, 13874628, 9668577, 14007462, 13874649, 14007742, 14007703, 14007737, 13880727,
  13880903, 13881729, 14533714, 14533622, 14533672, 13882722, 14533669, 13883369, 13883420, 13883356,
  13883365, 13883274, 13997180, 9833212, 14532982, 8748671, 13493664, 13493666, 9447852, 8748690,
  14532986, 8750683, 8745870,
];

const MUAS_SUBJECT = [
  14088043, 14107098, 14106988, 14107111, 14122436, 14199815, 14199813, 14606595, 14606587, 14606630,
  14606628, 14606632, 14607324, 14607308, 14606746, 14606764, 14606754, 14606857, 14605353, 14577391,
  14605319, 14577394, 14604869, 14577396, 14605796, 14605955, 14605875, 14605937, 14199828, 14514223,
  14089232, 14514284, 14200059, 14514322, 14514312, 14514357, 14514416, 14515863, 14515909, 14614583,
  14515917, 14609468, 14289977, 14609466, 14343729, 14343832, 14289132, 14609409, 14107508, 14289830,
  13819016, 13819025, 14285478, 14288673, 14288671, 14288675, 14288515, 14288765, 14288763, 14288784,
  14288754, 14288782, 13820267, 14064139, 14063848, 14064141, 14064127, 14412070, 14064126, 14412074,
  14203294, 14203297, 14201305, 14319003, 13819246, 13972467, 13972541, 13972581, 13972573, 13972598,
  13971833, 13972602, 13971825, 13926750, 13926748, 13926753, 13760945, 13760866, 13761466, 13761629,
  13761574, 13760867,
];

export const STAGED_WORK: Record<string, DuctsRouteDocument> = {
  g8745870: work(SA19_SUBJECT, {
    unit: {
      state: "assumed",
      ids: [9668311, 9668310],
      text: "SA 19 here is FC-17's supply: the group has two roots, FC-17 9668311 and dehumidifier DH-21 9668310, and I took FC-17 as the fan. SA 19 also names FC-35's network in another group.",
    },
    shape: {
      state: "proven",
      ids: [9668311, 14007462, 13880903, 14532982, 13493664, 14532986, 8745870],
      text: "The route leaves FC-17 through takeoff 14007462, passes the pants fitting 13880903, drops through takeoff 14532982 and volume damper 13493664, and ends at terminal 8745870 off takeoff 14532986, the longest of the five terminal runs.",
    },
    join: {
      state: "unproven",
      ids: [8747668, 8750451],
      text: "Terminal 8747668 is not connected: its collar sits 2.0 in from the open end of duct 8750451, so I joined it by proximity. Is it meant to hang off this run?",
    },
    branch: {
      state: "unproven",
      ids: [9668310, 13511627, 9668577],
      text: "DH-21 9668310 discharges into FC-17's supply at duct 9668577 through 13511627, upstream of every terminal. Is the dehumidifier meant to share this trunk, or is that a modelling shortcut?",
    },
    direction: {
      state: "assumed",
      ids: [14533622, 13882722, 13883369, 9833212],
      text: "Between 14533622 and 9833212 every connector reads bidirectional, so the model does not say which way air moves; I assumed it runs from FC-17 toward 8745870 like the rest of the walk.",
    },
  }),
  g14122436: work(MUAS_SUBJECT, {
    unit: {
      state: "unproven",
      ids: [13760867, 8732550],
      text: "Two units carry the label FC-23: 13760867 in New Construction and 8732550 in Future. I ended the route at 13760867. Is that the FC-23 you mean?",
    },
    gap: {
      state: "unproven",
      ids: [14122436, 14107111, 14106988],
      text: "The intake is not connected: duct 14122436 ends open about 2.6 in short of end cap 14107111 on the louver plenum 14106988. I joined them by proximity; it needs a ruling.",
    },
    backwards: {
      state: "unproven",
      ids: [14577391, 14605353, 14605319],
      text: "MUAS-1 14577391 looks placed backwards: walking from the louver, the route enters its Out port through 14605353 and leaves its In port through 14605319.",
    },
    taps: {
      state: "unproven",
      ids: [14515917, 14343729, 6105264, 6953852],
      text: "Two taps leave the trunk: 14515917 toward RV-15 6105264 and 14343729 toward RV-7 6953852. Are those takeoffs intended, so this is a branched network, not one run?",
    },
    stop: {
      state: "unproven",
      ids: [13926753, 13760945, 13760866, 13760867],
      text: "Supply takeoff 13926753 taps into return duct 13760945. Should the route stop at that takeoff, or continue through FR-1 13760866 to FC-23's return inlet as drawn?",
    },
    north: {
      state: "unproven",
      ids: [14088043, 13760867],
      text: "The snapshot carries no angle to true north, so north and south in these claims are project north. Is that the orientation you read the plan in?",
    },
  }),
};
