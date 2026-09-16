import { useEffect, useState } from "react";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { inspectAtomRegistry } from "./atom-inspect";
import { appAtomRegistry } from "#/route";
import { inspectRetainedActions } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { Code, stringify } from "#/components/lang/code";

/** Presentation only. Its subscription observes inspector notifications, never producer atoms. */
export function OwnerInspector({
  registry = appAtomRegistry,
}: {
  registry?: AtomRegistry.AtomRegistry;
}) {
  const inspector = inspectAtomRegistry(registry);
  const [snapshot, setSnapshot] = useState(() => inspector.inspect());
  useEffect(() => {
    setSnapshot(inspector.inspect());
    return inspector.subscribe(() => setSnapshot(inspector.inspect()));
  }, [inspector]);
  return (
    <section aria-label="Route owner inspector" className="flex flex-col gap-3 p-3 overflow-auto">
      <p>
        Cached owner outputs. Unread values remain unknown. Readiness, subject, revision, token,
        read time, request and receipt steps are shown exactly as recorded.
      </p>
      <p>
        Known cause requires a recorded receipt or publication reference. Dependency edges and
        timestamps do not establish cause.
      </p>
      {snapshot.owners.length === 0 && <p>No owners exposed in this registry.</p>}
      {snapshot.owners.map((owner) => (
        <div key={owner.id} className="hairline-t pt-2">
          <strong>{owner.id}</strong>
          <details>
            <summary>lastLocalCall (separate from cause)</summary>
            <Code code={stringify(owner.lastLocalCall)} lang="json" title="lastLocalCall" />
          </details>
          <dl>
            {Object.entries(owner.references).flatMap(([kind, entries]) =>
              Object.entries(entries).map(([name, value]) => {
                let cause = "unknown";
                if (value.value) {
                  try {
                    const row = JSON.parse(value.value) as { id?: string; steps?: unknown[] };
                    if (row.id && Array.isArray(row.steps)) cause = `receipt ${row.id}`;
                  } catch {
                    /* opaque cached output */
                  }
                }
                return (
                  <div key={`${kind}/${name}`} className="hairline-t py-2">
                    <dt>
                      {kind}/{name}
                    </dt>
                    <dd>Readiness: {value.state}</dd>
                    <dd>
                      <Code code={value.value ?? "unknown (not read)"} lang="plaintext" />
                    </dd>
                    <dd>Known cause: {cause}</dd>
                  </div>
                );
              }),
            )}
          </dl>
        </div>
      ))}
      <details>
        <summary>Retained local admissions (inert evidence)</summary>
        <Code code={stringify(inspectRetainedActions())} lang="json" />
      </details>
    </section>
  );
}
