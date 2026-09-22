import type { SyntheticOp } from "#/lab/synthetic";
import { modelGlanceOps } from "#/lab/glance/model";
import { drawingSetOps } from "#/lab/glance/drawing-set";
import { topologyOps } from "#/lab/glance/topology";

export const syntheticOps: SyntheticOp[] = [...modelGlanceOps, ...drawingSetOps, ...topologyOps];
