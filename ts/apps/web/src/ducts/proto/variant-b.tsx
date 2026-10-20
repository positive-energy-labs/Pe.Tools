/** THROWAWAY (protoui round 1): variant B of the ducts route. */
import type { ProtoProps } from "./props";

export function VariantB(props: ProtoProps) {
  return (
    <div data-proto="B" style={{ padding: 24 }}>
      <h1>PROTO B</h1>
      <p>
        {props.snapshot ? `${props.snapshot.groups.length} groups` : "no snapshot"}
        {props.fromFixture ? " (fixture)" : ""}
      </p>
    </div>
  );
}
