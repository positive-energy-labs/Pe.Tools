import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { Observation } from "../../../../packages/agent-contracts/src/work-journal-door";
import type { ResolvedReadDescriptor } from "../../../../packages/agent-contracts/src/native-read-door";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { createRouteEnvironmentIssuer } from "../../../../packages/agent-contracts/src/route-kernel-environment";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetch: vi.fn(),
  artifact: vi.fn(),
  decode: vi.fn(),
}));
vi.mock("#/host/runtime", () => ({ hostFetch: mocks.fetch }));
vi.mock("#/host/client", () => ({ callHostRpc: mocks.rpc }));
vi.mock("#/scene/artifact", () => ({ fetchSceneArtifact: mocks.artifact }));
vi.mock("#/scene/psc1", () => ({ decodeScene: mocks.decode }));
import { createGeometryReadDoor } from "./geometry-read-door";
const first = <A>(observation: Observation<A>) =>
  new Promise<A>((resolve) => observation.subscribe(resolve, () => {}));
const target = () =>
  createRouteTokenIssuer().scope({
    target: { kind: "document", ref: { session: "bridge", openId: "open" } },
    work: null,
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetch.mockResolvedValue(
    Response.json({
      operationKey: "revit.detail.space-scene",
      processIncarnation: { pid: 71, startedAt: 92 },
      openDocumentLifetime: { openId: "open" },
      normalizedInput: '{"contextRepresentation":"overview","elementIds":[3],"z":{"a":2,"b":1}}',
      freshnessGeneration: "host-generation:7",
      representation: "overview",
    }),
  );
  mocks.rpc.mockResolvedValue({
    id: "artifact",
    bytes: 30,
    scene: { elements: 50000, triangles: 60000, work: { nativeMilliseconds: 100 } },
  });
  mocks.artifact.mockResolvedValue(new ArrayBuffer(0));
  mocks.decode.mockReturnValue({
    metadata: {
      stamp: {
        geometryCost: {
          plannedCount: 50000,
          newlyTessellatedCount: 50000,
          cumulativeTessellatedCount: 50000,
        },
      },
    },
  });
});
test("host owns the entire descriptor; resolve sends input and exact scope without a local fallback", async () => {
  const door = createGeometryReadDoor();
  const scope = target();
  const descriptor = await first(
    door.resolve(
      {
        representation: "overview",
        scope,
        subjects: { kind: "ids", ids: [] },
        native: {
          operationKey: "revit.detail.space-scene",
          input: { elementIds: [3], contextRepresentation: "meshes", z: { b: 1, a: 2 } },
        },
      },
      scope,
    ),
  );
  if ("kind" in descriptor) throw Error(descriptor.failure.message);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(descriptor.processIncarnation).toEqual({ pid: 71, startedAt: 92 });
  expect(descriptor.freshnessGeneration).toBe("host-generation:7");
  expect(descriptor.freshnessEvidence).toBeUndefined();
  expect(mocks.fetch.mock.calls[0][0]).toBe("/pe/reads/resolve");
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).input.contextRepresentation).toBe(
    "overview",
  );
  expect(descriptor.normalizedInput).toBe(
    '{"contextRepresentation":"overview","elementIds":[3],"z":{"a":2,"b":1}}',
  );
  const result = await first(door.join(descriptor));
  expect(result.kind).toBe("value");
  expect(mocks.rpc.mock.calls[0][2]).toMatchObject({
    bridgeSessionId: "bridge",
    openDocumentId: "open",
  });
  expect((await first(door.join({ ...descriptor }))).kind).toBe("refused");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
test("missing incarnation refuses without native dispatch", async () => {
  mocks.fetch.mockResolvedValue(
    Response.json(
      {
        kind: "refused",
        failure: { code: "ReadResolutionRefused", message: "Missing incarnation" },
      },
      { status: 409 },
    ),
  );
  const door = createGeometryReadDoor();
  const scope = target();
  const result = await first(
    door.resolve(
      {
        representation: "overview",
        scope,
        subjects: { kind: "ids", ids: [] },
        native: { operationKey: "revit.detail.space-scene", input: { elementIds: [3] } },
      },
      scope,
    ),
  );
  expect(result).toMatchObject({ kind: "refused" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
test("non-overview modes classify as detail and release aborts transport", async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({
      operationKey: "revit.detail.space-scene",
      processIncarnation: { pid: 71, startedAt: 92 },
      openDocumentLifetime: { openId: "open" },
      normalizedInput:
        '{"contextRepresentation":"oriented","elementIds":[3],"contextPaddingFt":50000}',
      freshnessGeneration: "host:8",
      representation: "detail",
    }),
  );
  const door = createGeometryReadDoor();
  const scope = target();
  const tokens = createRouteTokenIssuer();
  const ownScope = tokens.scope(scope.identity);
  const attempt = tokens.attempt(ownScope, "detail", 1);
  if (!attempt.ok) throw Error(attempt.reason);
  const issuer = createRouteEnvironmentIssuer();
  const reach = issuer.mintReach(
    { kind: "subjects", ids: ['["doc",null,"unique"]' as any] },
    50000,
    issuer.mintExplicit(attempt.value),
  );
  const descriptor = await first(
    door.resolve(
      {
        representation: "oriented",
        reach,
        native: { operationKey: "revit.detail.space-scene", input: { elementIds: [3] } },
      },
      ownScope,
    ),
  );
  if ("kind" in descriptor) throw Error(descriptor.failure.message);
  expect(descriptor.representation).toBe("detail");
  expect(JSON.parse(descriptor.normalizedInput).contextPaddingFt).toBe(50000);
  mocks.rpc.mockImplementation(() => new Promise(() => {}));
  const release = door.join(descriptor as ResolvedReadDescriptor).subscribe(
    () => {},
    () => {},
  );
  const signal = mocks.rpc.mock.calls.at(-1)![2].signal as AbortSignal;
  release();
  expect(signal.aborted).toBe(true);
});
