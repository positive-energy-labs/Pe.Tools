import type {
  GeometryReadDoor,
  ReadCost,
} from "../../../../packages/agent-contracts/src/native-read-door";
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type {
  GeometryRequest,
  GeometryScope,
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
      request?: GeometryRequest<
        import("../../../../packages/agent-contracts/src/route-kernel-environment").SceneContextRepresentation
      >;
      generation?: string | null;
    }
  >();
  const demanded = new Set<string>();
  const retained = new Map<
    string,
    {
      signature: string;
      snapshot: ReadingSnapshot<unknown>;
      request?: GeometryRequest<
        import("../../../../packages/agent-contracts/src/route-kernel-environment").SceneContextRepresentation
      >;
      generation?: string | null;
    }
  >();
  const probes = new Map<string, () => void>();
  const stopProbe = (id: string) => {
    probes.get(id)?.();
    probes.delete(id);
  };
  const probe = (
    id: string,
    request: GeometryRequest<
      import("../../../../packages/agent-contracts/src/route-kernel-environment").SceneContextRepresentation
    >,
    generation: string | null,
    immediate = false,
  ) => {
    if (!options.door || probes.has(id)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release = () => {};
    probes.set(id, () => {
      stopped = true;
      clearTimeout(timer);
      release();
    });
    const check = () => {
      release = options.door!.resolve(request, owner.read()!.scope).subscribe(
        (descriptor) => {
          if (stopped || "kind" in descriptor) return;
          if (descriptor.freshnessGeneration !== generation) {
            stopProbe(id);
            retained.delete(id);
            retire(id);
            options.notify();
          }
        },
        () => {},
      );
      if (stopped) release();
      else
        timer = setTimeout(() => {
          release();
          check();
        }, 5000);
    };
    if (immediate) check();
    else timer = setTimeout(check, 5000);
  };
  const costs: Record<string, ReadCost> = {};
  let subjectSignature = "";
  let closed = false;
  const retire = (id: string) => {
    stopProbe(id);
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
      retained.clear();
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
    const saved = retained.get(id);
    if (saved?.signature === signature) {
      if (saved.request && saved.generation !== undefined)
        probe(id, saved.request, saved.generation, true);
      return saved.snapshot;
    }
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
      request: undefined as
        | GeometryRequest<
            import("../../../../packages/agent-contracts/src/route-kernel-environment").SceneContextRepresentation
          >
        | undefined,
      generation: undefined as string | null | undefined,
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
    const field = route.data.fields[route.data.subject.field]!;
    const identity =
      field.role === "subject"
        ? typeof field.identity === "string"
          ? route.data.identities[field.identity]
          : subject && typeof subject === "object" && "kind" in subject
            ? route.data.identities[String(subject.kind)]
            : undefined
        : undefined;
    const candidates =
      typeof subject === "string"
        ? [subject]
        : subject && typeof subject === "object" && "ids" in subject
          ? (subject as { ids: string[] }).ids
          : subject && typeof subject === "object" && "id" in subject
            ? [(subject as { id: string }).id]
            : [];
    // Identity meaning comes from admission, never from trying element syntax on a region.
    const ids = (identity?.kind === "element" ? candidates : []).filter(
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
      const regionId = candidates[0];
      const region = input && typeof input === "object" && "region" in input ? input.region : null;
      // The reading plan has validated entry input. Native ids retain the exact document scope;
      // they must never be encoded as fabricated UniqueIds or installed in Page/selection.
      const nativeIds =
        subject === null && input && typeof input === "object" && "elementIds" in input
          ? input.elementIds
          : undefined;
      const preparedSubject: GeometryScope | undefined = ids.length
        ? { kind: "subjects", ids: [ids[0]!, ...ids.slice(1)] }
        : identity?.kind === "local" &&
            candidates.length === 1 &&
            typeof regionId === "string" &&
            identityCodecs.local.decode(regionId).ok &&
            region &&
            typeof region === "object"
          ? { kind: "region", id: regionId as IdentityId<"local"> }
          : Array.isArray(nativeIds) &&
              nativeIds.length > 0 &&
              nativeIds.every((id) => Number.isSafeInteger(id) && id > 0) &&
              token.scope.identity.target?.kind === "document"
            ? { kind: "subjects", ids: [nativeIds[0], ...nativeIds.slice(1)], scope: token.scope }
            : undefined;
      // TODO: Prepare family-document detail only once the host door can establish family-document
      // evidence for the exact openId; a document identity alone also names unbounded projects.
      if (!preparedSubject) {
        record.snapshot = unavailable(
          "Explicit detail requires native subjects, an admitted region input, or validated elementIds with an exact document target",
        );
        return record.snapshot;
      }
      const invocation = owner.invocation(token, {});
      if (!invocation.ok || !owner.current(invocation.value)) {
        record.snapshot = unavailable("Current invocation required");
        return record.snapshot;
      }
      record.current = () => owner.current(invocation.value);
      const explicit = issuer.mintExplicit(invocation.value.token);
      const reach = issuer.mintReach(preparedSubject, geometry.reachFt, explicit);
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
    record.request = request;
    const resolution = options.door.resolve(request, token.scope).subscribe(
      (descriptor) => {
        if (!owner.current(token) || active.get(id) !== record) return;
        if ("kind" in descriptor) {
          accept(unavailable(descriptor.failure.message));
          return;
        }
        record.generation = descriptor.freshnessGeneration;
        const target = token.scope.identity.target;
        if (
          request.representation !== "overview" &&
          request.reach.subject.kind === "subjects" &&
          "scope" in request.reach.subject &&
          (target?.kind !== "document" ||
            !("openId" in descriptor.openDocumentLifetime) ||
            descriptor.openDocumentLifetime.openId !== target.ref.openId)
        ) {
          accept(unavailable("Host descriptor does not match the invocation document lifetime"));
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
            if (active.get(id) === record) probe(id, request, descriptor.freshnessGeneration);
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
  const refresh = (id: string, notify = true) => {
    if (closed) return;
    syncSubject();
    retire(id);
    retained.delete(id);
    demanded.add(id);
    if (notify) options.notify();
  };
  return {
    read,
    syncSubject,
    leased: (id: string) => active.has(id),
    suspend(id: string) {
      const prior = active.get(id);
      if (prior?.snapshot.current)
        retained.set(id, {
          signature: prior.signature,
          snapshot: prior.snapshot,
          request: prior.request,
          generation: prior.generation,
        });
      retire(id);
    },
    invalidate(id: string) {
      retire(id);
      retained.delete(id);
    },
    cancel(id: string) {
      retire(id);
      retained.delete(id);
      demanded.delete(id);
    },
    costs,
    refresh,
    actions: Object.fromEntries(
      Object.entries(route.data.readings)
        .filter(([, r]) => r.kind === "use" && r.geometry?.representation === "detailed")
        .map(([id]) => [id, { readDetailed: () => refresh(id), refresh: () => refresh(id) }]),
    ),
    close() {
      closed = true;
      for (const id of probes.keys()) stopProbe(id);
      for (const id of active.keys()) retire(id);
    },
  };
}
