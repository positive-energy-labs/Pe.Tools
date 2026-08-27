/**
 * THE VERB LANE — one rendering of the `busy`/`failure`/`receipt` triple every route store
 * carries. Busy wins, then the failure, then anything standing, then the receipt: a transient
 * receipt never hides a standing condition the page wants to keep saying.
 */
import { useAtomValue } from "@effect/atom-react";
import type * as Atom from "effect/unstable/reactivity/Atom";
import type { ReactNode } from "react";

import { OutcomeLine } from "#/components/lang/outcome";
import type { VerbFailure, VerbReceipt } from "#/state/route-store";

export interface VerbAtoms {
  busy: Atom.Atom<{ id: string; seconds: number } | null>;
  failure: Atom.Atom<VerbFailure | null>;
  receipt: Atom.Atom<VerbReceipt | null>;
}

export function VerbLane({
  atoms,
  standing,
  className,
}: {
  atoms: VerbAtoms;
  standing?: ReactNode;
  className?: string;
}) {
  const busy = useAtomValue(atoms.busy);
  const failure = useAtomValue(atoms.failure);
  const receipt = useAtomValue(atoms.receipt);
  if (busy)
    return (
      <OutcomeLine kind="busy" label={`${busy.id} · ${busy.seconds}s`} className={className} />
    );
  if (failure)
    return (
      <OutcomeLine
        kind={failure.kind}
        label={`${failure.verb} failed`}
        says={failure.message}
        className={className}
      />
    );
  if (standing) return <>{standing}</>;
  return receipt ? <OutcomeLine kind="receipt" label={receipt.text} className={className} /> : null;
}
