/** THROWAWAY (protoui round 2): E1, the shared E screen with the losses sidebar. */
import { LOSSES_SIDEBAR } from "./e/losses-sidebar";
import { EScreen } from "./e/screen";
import type { ProtoProps } from "./props";

export function VariantE1(props: ProtoProps) {
  return <EScreen props={props} variant="E1" sidebar={LOSSES_SIDEBAR} />;
}
