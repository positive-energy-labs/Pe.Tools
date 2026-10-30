import { SCENE_FIXTURE } from "./scene.fixture";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import sheetFixture from "./sheet/sheet.fixture.json";

const systems = Array.from({ length: 369 }, (_, index) => ({
  id: 900 + index,
  name: `SA ${index + 1} - Supply Air - Level 2 North`,
  classification: "Supply Air",
  criticalPath: [],
  sections: [],
}));
const names = new Map([
  ["SA Office", systems[18]!.name],
  ["SA Lab", systems[1]!.name],
  ["EA Lab", systems[2]!.name],
]);
const named = <T extends { systemName?: string | null }>(element: T): T => ({
  ...element,
  systemName: element.systemName
    ? (names.get(element.systemName) ?? element.systemName)
    : element.systemName,
});

/** Layout stress only: Project A geometry with Chadds-sized synthetic names and rosters. */
export const LAYOUT_FIXTURE = {
  ...SCENE_FIXTURE,
  snapshot: {
    ...SCENE_FIXTURE.snapshot,
    systems,
    nodes: [...SCENE_FIXTURE.snapshot.nodes, ...NAVIGATION_FIXTURE.snapshot.nodes.map(named)],
    segments: [
      ...SCENE_FIXTURE.snapshot.segments,
      ...NAVIGATION_FIXTURE.snapshot.segments.map(named),
    ],
    issues: NAVIGATION_FIXTURE.snapshot.issues,
    groups: [
      ...NAVIGATION_FIXTURE.snapshot.groups.map((group) => ({
        ...group,
        systemNames: group.systemNames.map((name) => names.get(name)!),
      })),
      ...systems
        .filter((system) => ![...names.values()].includes(system.name))
        .map((system) => ({
          id: `layout-${system.id}`,
          rootIds: [],
          classifications: [system.classification],
          systemNames: [system.name],
          terminalCount: 0,
          elementCount: 0,
          loops: 0,
          issueIds: [],
        })),
    ],
  },
};

export const LAYOUT_ROSTER = {
  ...sheetFixture.roster,
  rows: [
    ...sheetFixture.roster.rows,
    ...Array.from({ length: 96 }, (_, index) => ({
      ...sheetFixture.roster.rows[0]!,
      unitId: 20000000 + index,
      mark: `AHU ${index + 1} - Chadds - Level 2 North Mechanical Room`,
    })),
  ],
};
