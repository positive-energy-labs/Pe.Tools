import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { RegistryContext } from "@effect/atom-react";
import type { ReactNode } from "react";
import { AttentionScope } from "#/attention";
import type { SubjectKey } from "@pe/kit/lang/attention";
const empty = Atom.make<ReadonlySet<SubjectKey>>(new Set<SubjectKey>());
export function TestAttention({
  registry,
  children,
  doc = "test",
}: {
  registry: AtomRegistry.AtomRegistry;
  children: ReactNode;
  doc?: string;
}) {
  return (
    <RegistryContext value={registry}>
      <AttentionScope doc={doc} selected={empty}>
        {children}
      </AttentionScope>
    </RegistryContext>
  );
}
