import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { RegistryContext } from "@effect/atom-react";
import type { ReactNode } from "react";
import { AttentionScope } from "#/attention";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { elementIndex } from "#/element-index";
/** Tests name an element by its ElementId; its UniqueId is `u<id>`. */
export const uid = (id: number) => `u${id}`;
export const eKey = (id: number) => elementKey(uid(id));
export const testElements = (ids: readonly number[]) =>
  elementIndex(ids.map((id) => ({ id, uniqueId: uid(id) })));
const empty = Atom.make<ReadonlySet<SubjectKey>>(new Set<SubjectKey>());
export function TestAttention({
  registry,
  children,
  ids = [],
}: {
  registry: AtomRegistry.AtomRegistry;
  children: ReactNode;
  /** ElementIds this test's pane shows. */
  ids?: readonly number[];
}) {
  return (
    <RegistryContext value={registry}>
      <AttentionScope doc="test" selected={empty} elements={testElements(ids)}>
        {children}
      </AttentionScope>
    </RegistryContext>
  );
}
