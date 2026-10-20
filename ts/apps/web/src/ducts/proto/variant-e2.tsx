/** THROWAWAY (protoui round 2): E2, the shared E screen with the tree sidebar. */
import { EScreen } from "./e/screen";
import { TREE_SIDEBAR } from "./e/tree-sidebar";
import type { ProtoProps } from "./props";

export function VariantE2(props: ProtoProps) {
  return <EScreen props={props} variant="E2" sidebar={TREE_SIDEBAR} />;
}
