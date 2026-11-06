import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { RegistryContext } from "@effect/atom-react";
import type { ReactNode } from "react";
import { AttentionScope } from "#/attention";
import type { SubjectKey } from "@pe/kit/lang/attention";
const empty = Atom.make<ReadonlySet<SubjectKey>>(new Set<SubjectKey>());
export function TestAttention({
  registry,
  children,
}: {
  registry: AtomRegistry.AtomRegistry;
  children: ReactNode;
}) {
  return (
    <RegistryContext value={registry}>
      <AttentionScope doc="test" selected={empty}>
        {children}
      </AttentionScope>
    </RegistryContext>
  );
}
