import { createHash } from "node:crypto";
import { canonicalRouteInput, type DemoSeed } from "@pe/agent-contracts";
import type {
  RhvacExtractData,
  RhvacRoomData,
  RhvacSyncRequest,
  RhvacSyncResult,
} from "@pe/host-contracts/operation-types";
import { BridgeError } from "./bridge.ts";
import { assertDemoPath } from "./demo-settings.ts";

const simulation = "Simulated RHVAC file effect; no file read or written, no application started";
type Sample = NonNullable<Extract<DemoSeed, { route: "takeoffs" }>["readings"]["rhvac"]>;
const refuse = (message: string) => new BridgeError(message, 409, { notDispatched: true });

/** Fixed sample facts checked against the real planner's request, not an alternate writer. */
export function createDemoRhvac(
  root: string,
  path: string,
  id: string,
  sample?: Sample,
  failure?: DemoSeed["failure"],
) {
  const blank: RhvacRoomData = {
    identifier: 1,
    number: 1,
    name: "Existing demo room",
    systemNumber: 1,
    zoneNumber: 1,
    areaSquareFeet: 0,
    ceilingHeightFeet: 9,
    people: 0,
    lightingWatts: 0,
    equipmentSensibleBtuh: 0,
    equipmentLatentBtuh: 0,
    ventilationCfm: 0,
    floors: [],
    roofs: [],
    walls: [],
    glass: [],
    doors: [],
  };
  const inserted = {
    number: 2,
    name: "Reviewed demo room",
    systemNumber: 1,
    zoneNumber: 1,
    areaSquareFeet: 100,
    ceilingHeightFeet: 9,
    people: 1,
    lightingWatts: 100,
    equipmentSensibleBtuh: 0,
    equipmentLatentBtuh: 0,
    ventilationCfm: 10,
    floors: [
      {
        assembly:
          "R-19 open cell 1/2 lb. spray foam insulation, 5 inches in 2 x 10 joist cavity, any cover",
        uValue: 0.051,
        areaSquareFeet: 100,
        exposedPerimeterFeet: 40,
      },
    ],
    roofs: [
      {
        assembly: "R49 closed cell sprayfoam in 2x14 joist cavity",
        uValue: 0.024,
        areaSquareFeet: 100,
        areaMultiplier: 1.2,
      },
    ],
    walls: [3, 5, 7, 1].map((direction, index) => ({
      index1: index + 1,
      assembly:
        "R-3 insulated sheathing, R-13 closed cell sprayfoam in a 2x6 wood stud cavity, R-15 Fiberglass batt",
      uValue: 0.036,
      lengthFeet: 10,
      heightFeet: 9,
      direction,
    })),
    glass: [],
    doors: [],
  };
  const before: RhvacExtractData = {
    sourceFile: path,
    fileIdentity: {
      fileName: "demo.r10",
      projectTitle: "Simulated sample",
      clientName: "Demo",
      stamp: `${id}:simulated`,
    },
    building: {},
    systems: [{ number: 1, name: "Demo system" }],
    rooms: [blank],
  };
  const after: RhvacExtractData = { ...before, rooms: [blank, { identifier: 2, ...inserted }] };
  const missing: RhvacExtractData = {
    ...before,
    systems: [],
    rooms: [blank, { ...blank, identifier: 2, number: 2, name: "Second existing room" }],
  };
  let current =
    sample?.state === "after" ? after : sample?.state === "missing-system" ? missing : before;
  const expected: RhvacSyncRequest = {
    targetPath: path,
    updates: [],
    inserts: [inserted],
    systems: before.systems,
    deleteUntouchedSeedRoom: true,
  };
  const version = () =>
    `simulated:${createHash("sha256").update(canonicalRouteInput(current)).digest("hex")}`;
  const confined = async (requested: string) => {
    try {
      if ((await assertDemoPath(root, requested)).toLowerCase() !== path.toLowerCase())
        throw Error("Unsupported simulated RHVAC destination");
    } catch (error) {
      throw refuse(error instanceof Error ? error.message : String(error));
    }
  };
  return {
    fileIdentity: `${before.fileIdentity.fileName}#${before.fileIdentity.stamp}`,
    async fileVersion(this: void, requested: string) {
      await confined(requested);
      return version();
    },
    async openFile(this: void, requested: string) {
      await confined(requested);
      return { ...structuredClone(current), simulated: true, simulation };
    },
    async syncFile(
      this: void,
      request: RhvacSyncRequest,
      token: string,
    ): Promise<RhvacSyncResult & { simulated: true; simulation: string }> {
      await confined(request.targetPath);
      if (token !== version()) throw refuse("Simulated RHVAC reading changed before the leaf");
      if (current !== before || canonicalRouteInput(request) !== canonicalRouteInput(expected))
        throw refuse("Unsupported simulated RHVAC sample input; no effect performed");
      if (failure?.kind === "refusal")
        throw refuse(`Simulated RHVAC leaf refusal: ${failure.message}`);
      current = after;
      if (failure?.kind === "unknown")
        throw new BridgeError(
          "Simulated RHVAC outcome unknown; supplied reading is not receipt proof",
          503,
        );
      return {
        targetPath: path,
        backupPath: null,
        swapped: true,
        fileIdentity: after.fileIdentity,
        systems: [{ number: 1, name: "Demo system", identifier: 1, seeded: false }],
        insertedRooms: [{ number: 2, name: inserted.name, identifier: 2 }],
        updated: 0,
        seedRoom: { identifier: 1, action: "kept", reason: "Supplied named sample room" },
        assemblyFallbacks: [],
        roomsBefore: 1,
        roomsAfter: 2,
        log: simulation,
        simulated: true,
        simulation,
      };
    },
    async local(this: void, key: string, input: unknown) {
      if (key !== "rhvac.launch") throw refuse(`Unsupported simulated local operation: ${key}`);
      const requested = (input as { path: string }).path;
      await confined(requested);
      if (failure?.kind === "refusal") throw refuse(`Simulated launch refusal: ${failure.message}`);
      if (failure?.kind === "unknown")
        throw new BridgeError("Simulated launch outcome unknown", 503);
      return {
        path: requested,
        launched: false,
        simulated: true,
        simulation: "Simulated launch request; no application started",
      };
    },
    seed(): Sample {
      return {
        sample: "rectangular-room-v1",
        state: current === after ? "after" : current === missing ? "missing-system" : "before",
        simulated: true,
      };
    },
  };
}
