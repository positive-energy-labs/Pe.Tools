/** THROWAWAY (protoui round 1): variant D of the ducts route. */
import type { ProtoProps } from "./props";

export function VariantD(props: ProtoProps) {
  return (
    <div data-proto="D" style={{ padding: 24 }}>
      <h1>PROTO D</h1>
      <p>
        {props.snapshot ? `${props.snapshot.groups.length} groups` : "no snapshot"}
        {props.fromFixture ? " (fixture)" : ""}
      </p>
    </div>
  );
}
