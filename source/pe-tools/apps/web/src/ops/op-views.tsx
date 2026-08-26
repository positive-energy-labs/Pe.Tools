import type { OpViewRegistry } from "#/ops/registry";
import { views as catalogViews } from "#/ops/views-catalog";
import { views as contextViews } from "#/ops/views-context";
import { views as detailViews } from "#/ops/views-detail";
import { views as electricalViews } from "#/ops/views-electrical";
import { views as hostViews } from "#/ops/views-host";

export const opViews: OpViewRegistry = {
  ...contextViews,
  ...catalogViews,
  ...detailViews,
  ...electricalViews,
  ...hostViews,
};
