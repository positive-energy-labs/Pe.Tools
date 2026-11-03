import type {
  GeometryReadDoor,
  ReadCost,
} from "../../../../packages/agent-contracts/src/native-read-door";
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type {
  GeometryRequest,
  GeometryOutcome,
  RouteEnvironmentIssuer,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
type Owner = ReturnType<typeof createRouteScopeGate>;
import { z } from "zod";
import { freezePage, identityCodecs } from "./page-port";
const unavailable = (reason: string): ReadingSnapshot<unknown> => ({
  status: "unavailable",
  current: false,
  reason,
});
/** This is mount composition, never a route callback or an alternate acceptance owner. */
export function createAdmittedGeometry(options: {
  route: AdmittedRoute;
  owner: Owner;
  issuer: RouteEnvironmentIssuer;
  entries: Readonly<Record<string, { output: z.ZodType }>>;
  door: GeometryReadDoor<unknown> | undefined;
  notify(): void;
}) {
  const { route, owner, issuer } = options;
  const active = new Map<
    string,
    {
      signature: string;
      token: ReturnType<Owner["capture"]>;
      snapshot: ReadingSnapshot<unknown>;
      release(): void;
      current(): boolean;
    }
  >();
  const demanded = new Set<string>();
  const costs: Record<string, ReadCost> = {};
  let subjectSignature = "";
  let closed = false;
  const retire = (id: string) => {
    const prior = active.get(id);
    if (!prior) return;
    active.delete(id);
    delete costs[id];
    owner.retire(prior.token);
    prior.release();
  };
  const syncSubject = () => {
    const page = owner.read()!.page;
    const signature = canonicalEnvironmentInput(
      Object.fromEntries(
        Object.entries(route.data.fields)
          .filter(([, field]) => field.role === "subject" || field.role === "selection")
          .map(([key]) => [key, page[key]]),
      ),
    );
    if (signature !== subjectSignature) {
      subjectSignature = signature;
      for (const id of active.keys()) retire(id);
      demanded.clear();
    }
  };
  const read = (id: string, _context: unknown, input: unknown): ReadingSnapshot<unknown> => {
    syncSubject();
    const declaration = route.data.readings[id]!;
    if (declaration.kind !== "use" || !declaration.geometry) return unavailable("Not geometry");
    const geometry = declaration.geometry;
    if (geometry.representation !== "overview" && !demanded.has(id))
      return unavailable("Explicit demand required");
    const signature = canonicalEnvironmentInput({ input, subjectSignature });
    if (active.has(id) && active.get(id)!.signature !== signature) {
      retire(id);
      if (geometry.representation !== "overview") {
        demanded.delete(id);
        return unavailable("Explicit detail refresh required");
      }
    }
    const prior = active.get(id);
    if (prior) {
      if (prior.current()) return prior.snapshot;
      retire(id);
      demanded.delete(id);
      return unavailable("Explicit detail refresh required");
    }
    const token = owner.capture(id);
    const record = {
      signature,
      token,
      snapshot: {
        status: "pending",
        current: false,
        reason: "Geometry pending",
      } as ReadingSnapshot<unknown>,
      release: () => {},
      current: () => owner.current(token),
    };
    active.set(id, record);
    const releases = new Set<() => void>();
    record.release = () => {
      for (const release of releases) release();
      releases.clear();
    };
    const retain = (release: () => void) => {
      if (closed || active.get(id) !== record) release();
      else releases.add(release);
    };
    const accept = (snapshot: ReadingSnapshot<unknown>) => {
      if (!closed && active.get(id) === record && owner.current(token)) {
        record.snapshot = freezePage(snapshot);
        options.notify();
      }
    };
    const page = owner.read()!.page;
    const subject = page[route.data.subject.field];
    const candidates =
      typeof subject === "string"
        ? [subject]
        : subject && typeof subject === "object" && "ids" in subject
          ? (subject as { ids: string[] }).ids
          : subject && typeof subject === "object" && "id" in subject
            ? [(subject as { id: string }).id]
            : [];
    const ids = candidates.filter(
      (id): id is IdentityId<"element"> => identityCodecs.element.decode(id).ok,
    );
    let request: GeometryRequest<
      import("../../../../packages/agent-contracts/src/route-kernel-environment").SceneContextRepresentation
    >;
    const native = { operationKey: declaration.entry, input, readingId: id };
    if (geometry.representation === "overview")
      request = {
        representation: "overview",
        subjects: { kind: "ids", ids },
        scope: token.scope,
        native,
      };
    else {
      if (!ids.length) {
        record.snapshot = unavailable("Explicit detail requires native subjects");
        return record.snapshot;
      }
      const invocation = owner.invocation(token, {});
      if (!invocation.ok || !owner.current(invocation.value)) {
        record.snapshot = unavailable("Current invocation required");
        return record.snapshot;
      }
      record.current = () => owner.current(invocation.value);
      const explicit = issuer.mintExplicit(invocation.value.token);
      const reach = issuer.mintReach(
        { kind: "subjects", ids: [ids[0]!, ...ids.slice(1)] },
        geometry.reachFt,
        explicit,
      );
      const mode = (
        input as {
          contextRepresentation?: import("../../../../packages/agent-contracts/src/route-kernel-environment").SceneContextRepresentation;
        }
      ).contextRepresentation;
      request = { representation: mode && mode !== "overview" ? mode : "meshes", reach, native };
    }
    if (!options.door) {
      record.snapshot = unavailable("Geometry service unavailable");
      return record.snapshot;
    }
    let joined = () => {};
    const resolution = options.door.resolve(request, token.scope).subscribe(
      (descriptor) => {
        if (!owner.current(token) || active.get(id) !== record) return;
        if ("kind" in descriptor) {
          accept(unavailable(descriptor.failure.message));
          return;
        }
        const output = z.custom<GeometryOutcome<unknown>>((value) => {
          if (!value || typeof value !== "object" || !("kind" in value)) return false;
          const outcome = value as GeometryOutcome<unknown>;
          return outcome.kind === "ready"
            ? options.entries[declaration.entry]!.output.safeParse(outcome.value).success &&
                !!outcome.geometryCost
            : (outcome.kind === "unavailable" || outcome.kind === "cancelled") &&
                typeof outcome.reason === "string";
        });
        const nominal = issuer.mintGeometryFromHost(descriptor, output, route, token, request);
        // Acquisition authenticates the exact D instance and current attempt before joining.
        if (!issuer.owns(nominal) || nominal.token !== token || !record.current()) return;
        releases.delete(joined);
        joined();
        joined = options.door!.join(nominal.descriptor!).subscribe(
          (result) => {
            if (closed || active.get(id) !== record || !record.current()) return;
            if (result.kind !== "value") {
              accept(unavailable(result.kind === "refused" ? result.failure.message : result.kind));
              return;
            }
            if (result.descriptor !== nominal.descriptor) {
              accept(unavailable("Rebound geometry answer"));
              return;
            }
            if (!nominal.output.safeParse(result.value).success) {
              accept(unavailable("Invalid geometry outcome"));
              return;
            }
            const outcome = result.value;
            if (outcome.kind !== "ready") {
              accept(unavailable(outcome.reason));
              return;
            }
            const parsed = options.entries[declaration.entry]!.output.safeParse(outcome.value);
            if (!parsed.success) {
              accept({ status: "failed", current: false, reason: parsed.error.message });
              return;
            }
            costs[id] = freezePage(result.cost);
            accept({
              status: "ready",
              current: true,
              value: Object.freeze({ ...outcome, value: parsed.data }),
              hash: canonicalEnvironmentInput(outcome),
            });
          },
          () => {},
        );
        retain(joined);
      },
      () => {},
    );
    retain(resolution);
    return record.snapshot;
  };
  const refresh = (id: string) => {
    if (closed) return;
    syncSubject();
    retire(id);
    demanded.add(id);
    options.notify();
  };
  return {
    read,
    syncSubject,
    costs,
    refresh,
    actions: Object.fromEntries(
      Object.entries(route.data.readings)
        .filter(([, r]) => r.kind === "use" && r.geometry?.representation === "detailed")
        .map(([id]) => [id, { readDetailed: () => refresh(id), refresh: () => refresh(id) }]),
    ),
    close() {
      closed = true;
      for (const id of active.keys()) retire(id);
    },
  };
}
