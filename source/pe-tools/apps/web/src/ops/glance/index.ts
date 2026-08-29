import type { SyntheticOp } from "#/ops/synthetic";
import { modelGlanceOps } from "#/ops/glance/model";
import { drawingSetOps } from "#/ops/glance/drawing-set";
import { topologyOps } from "#/ops/glance/topology";

export const syntheticOps: SyntheticOp[] = [...modelGlanceOps, ...drawingSetOps, ...topologyOps];
