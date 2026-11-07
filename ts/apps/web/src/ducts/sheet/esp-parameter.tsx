import { StateCell, type CellHandle } from "@pe/kit/lang/cell";
import type { ValueHandle } from "@pe/kit/lang/collection";
import type { OpResponseOf } from "@pe/host-contracts/operation-types";
/** The accepted Value owns options and their freshness; the slot stages a parameter name. */
export function EspParameter({cell,value,model,options:offered,error}:{
  cell:CellHandle;value?:ValueHandle<unknown>;model:string;
  options:OpResponseOf<"revit.catalog.field-options">|null;error:string|null;
}) {
  const options=(offered?.items??[]).flatMap(item=>item.metadata?.name?[{
    key:item.value,label:item.label,value:item.metadata.name,
    description:[item.metadata.kind,item.metadata.storageType,item.metadata.dataTypeId].filter(Boolean).join(" · "),
  }]:[]);
  const current=String(cell.value.edit?.value??model);
  const refusal=error??(!offered?"Read unit parameter options":offered.result.kind!=="Success"?offered.result.message:!options.length?"No numeric parameters on these units":null);
  return <StateCell cell={cell} value={value} label="Unit ESP" model={model} options={options}
    current={options.find(option=>option.value===current)?.key??null} capReason={refusal??undefined}
    damage={!refusal&&!options.some(option=>option.value===current)?"Parameter not offered by these units":undefined}/>;
}
