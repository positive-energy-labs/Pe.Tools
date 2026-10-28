import { Demo } from "#/design-system/exhibit";
import { LevelMarks, LevelReadout } from "#/scene/level-marks";
import { levelExtents, type SceneLevels } from "#/scene/levels";
import type { Project } from "#/scene/projection";

const BOUNDS = { minX: 0, maxX: 40, minY: 0, maxY: 20, minZ: 2, maxZ: 12 };
const LEVELS: SceneLevels = {
  sources: [
    {
      source: 0,
      documentKey: "fixture-host",
      name: "Fixture host",
      status: "loaded",
      countedLevels: 3,
      unavailableLevelIds: [],
    },
    {
      source: 1,
      linkInstanceId: 5,
      name: "Fixture house placement",
      status: "unloaded",
      unavailableLevelIds: [],
      reason: "Link document is Unloaded.",
    },
  ],
  planes: [
    {
      point: [0, 0, 0],
      normal: [0, 0, 1],
      members: [
        {
          source: 0,
          elementId: 1,
          uniqueId: "ground",
          name: "Ground",
          projectElevationFt: 0,
          buildingStory: true,
        },
        {
          source: 0,
          elementId: 2,
          uniqueId: "level-0",
          name: "Level 0",
          projectElevationFt: 0,
          buildingStory: true,
        },
      ],
    },
    {
      point: [0, 0, 14],
      normal: [0, 0, 1],
      members: [
        {
          source: 0,
          elementId: 3,
          uniqueId: "roof",
          name: "Roof",
          projectElevationFt: 14,
          buildingStory: true,
        },
      ],
    },
  ],
  work: { nativeMilliseconds: 0, startPrivateBytes: 0, endPrivateBytes: 0 },
};
const project: Project = (p) => [20 + p[0]! * 6 + p[1]! * 2, 180 - p[2]! * 7 - p[1]! * 1.5];

export function LevelsSpecimen() {
  return (
    <Demo
      label="Measured level datums"
      consumers="/ducts · scene/levels.ts, scene/level-marks.tsx"
      spec="Fixture geometry. One quiet perimeter per measured plane; coincident names share a tick. The root inventory keeps every level and discloses unavailable source instances."
    >
      <svg viewBox="0 0 440 210" className="w-full text-ink-2" aria-label="Fixture level datums">
        {levelExtents(LEVELS, BOUNDS).map(({ corners, index }) => (
          <polygon
            key={index}
            points={corners.map((c) => project(c)!.join(",")).join(" ")}
            fill="none"
            stroke="currentColor"
            opacity={0.24}
          />
        ))}
        <LevelMarks
          levels={LEVELS}
          bounds={BOUNDS}
          project={project}
          size={{ width: 440, height: 210 }}
        />
      </svg>
      <LevelReadout levels={LEVELS} bounds={BOUNDS} />
    </Demo>
  );
}
