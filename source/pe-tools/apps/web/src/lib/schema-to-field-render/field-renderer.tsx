import { lazy, Suspense } from "react";
import { resolveCustomRenderer } from "./custom-renderer-registry";
import { type FieldRendererProps, useResolvedFieldNode } from "./shared";

const ArrayField = lazy(() =>
  import("./array-field").then((module) => ({ default: module.ArrayField })),
);
const ObjectField = lazy(() =>
  import("./object-field").then((module) => ({ default: module.ObjectField })),
);
const ScalarField = lazy(() =>
  import("./scalar-field").then((module) => ({ default: module.ScalarField })),
);

export function FieldRenderer(props: FieldRendererProps) {
  const resolved = useResolvedFieldNode(props);
  const nextProps = { ...props, ...resolved };
  const CustomRenderer = resolveCustomRenderer(resolved.effectiveNodeRef.uiMetadata()?.renderer);

  return (
    <Suspense
      fallback={<div className="h-16 animate-pulse rounded-lg border border-border bg-muted/30" />}
    >
      {CustomRenderer ? (
        <CustomRenderer {...nextProps} />
      ) : resolved.nodeType === "object" && resolved.effectiveNode.properties ? (
        <ObjectField {...nextProps} />
      ) : resolved.nodeType === "array" ? (
        <ArrayField {...nextProps} />
      ) : (
        <ScalarField {...nextProps} />
      )}
    </Suspense>
  );
}
