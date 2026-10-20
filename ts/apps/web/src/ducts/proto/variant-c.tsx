/** THROWAWAY (protoui round 1): variant C of the ducts route. */
import type { ProtoProps } from "./props";

export function VariantC(props: ProtoProps) {
  return (
    <div data-proto="C" style={{ padding: 24 }}>
      <h1>PROTO C</h1>
      <p>
        {props.snapshot ? `${props.snapshot.groups.length} groups` : "no snapshot"}
        {props.fromFixture ? " (fixture)" : ""}
      </p>
    </div>
  );
}
