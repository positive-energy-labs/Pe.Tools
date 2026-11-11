import { z } from "zod";
import { nativeResponseDefinitionSchema } from "@pe/host-contracts/decoders";
import type { DuctsSnapshotWalk } from "@pe/host-contracts/generated";
import { ductComponentWitnessSchema, ductCalculationSchema, ductAssumptionSchema } from "./ducts.ts";
import { ductsCriteriaLayerSchema, DUCT_UNIT_KINDS } from "./ducts-sheet.ts";
import { DUCT_INFERENCE_GRADES } from "./ducts-analysis.ts";
const n=z.number(),s=z.string(),nullable=n.nullable(),ns=z.array(n),ss=z.array(s);
const record=<S extends z.ZodType>(schema:S)=>z.record(s,schema);
const reason=z.object({code:s,elementId:nullable,message:s});
const connector=nativeResponseDefinitionSchema<DuctsSnapshotWalk.Res.DuctConnector>("ducts.snapshot.walk","DuctConnector");
const hydraulic=z.object({
  status:z.enum(["complete-for-prescribed-flow","partial","inconsistent"]),mode:z.literal("prescribed-flow-demand"),
  physicalComponentIds:ss,lawEvidence:z.array(z.object({from:s,to:s,totalPressureDifferenceInWg:n,elementId:nullable,source:s})),
  physicalPortCount:n,coveredPhysicalPortCount:n,physicalPartCount:n,coveredPhysicalPartCount:n,lawCount:n,pressureComponentCount:n,maxPressureResidualInWg:nullable,
  ports:z.array(z.object({elementId:n,index:n,relativePressureInWg:nullable,totalPressureInWg:nullable})),
  fanHeads:z.array(z.object({id:s,elementId:n,flowCfm:nullable,requiredExternalTotalPressureInWg:nullable})),reasons:z.array(reason),
});
const component=z.object({
  hydraulics:hydraulic.nullable(),id:s,elementIds:ns,componentWitness:ductComponentWitnessSchema,
  status:z.enum(["unique","underdetermined","inconsistent"]),nodeCount:n,cycleRank:n,unknownEdges:n,maxResidualCfm:nullable,
  edges:z.array(z.object({id:s,from:s,to:s,kind:z.enum(["joint","duct-subrun","station-arm","curve-continuity","fitting-arm","passive"]),elementId:n,lengthFt:nullable,signedCfm:nullable,source:z.enum(["conservation","staged-constraint"]).nullable()})),
  boundaries:z.array(z.object({port:s,injectionCfm:nullable,source:s,externalExchange:z.object({ownerOutwardCfm:nullable,inflowCfm:nullable,source:s,derivation:z.enum(["fan-design","fan-continuity"]).nullable(),fromComponentId:s.nullable()}).optional()})),reasons:z.array(reason),
});
export const circuitReadSchema=<R extends z.ZodType>(row:R)=>{
  const side=z.object({port:nullable,elementIds:ns,flowCfm:nullable,continuityResidualCfm:nullable,jointFlows:z.array(z.object({from:s,to:s,cfm:n})),totalPressureInWg:nullable,
    paths:z.array(z.object({terminalId:n,flowCfm:n,total:n,rows:z.array(row),balancingInWg:nullable})),backEdges:z.array(z.tuple([n,n])),reasons:z.array(reason)});
  return z.object({basis:z.literal("balanced-design-demand"),
    graph:z.object({ports:z.array(z.object({elementId:n,uniqueId:s,connector})),joints:z.array(z.object({a:s,b:s,reciprocal:z.boolean()})),parts:z.array(z.object({elementId:n,uniqueId:s,ports:ns,continuity:z.enum(["component","passive","fan-boundary","unknown-equipment"])}))}),
    coverage:z.object({equipment:n,passiveEquipment:n,fanEquipment:n,fanCircuits:n,unassignedEquipmentPorts:n,terminals:n,admittedTerminals:n,reachedTerminals:n}),
    circuits:z.array(z.object({id:s,equipmentId:n,uniqueId:s,flowCfm:nullable,inlet:side,outlet:side,requiredExternalTotalPressureInWg:nullable,requiredExternalStaticPressureInWg:nullable,status:z.enum(["complete-for-declared-design","partial"]),reasons:z.array(reason)})),componentFlows:z.array(component),reasons:z.array(reason),
  });
};
const grade=z.enum(DUCT_INFERENCE_GRADES);
export const inferenceReadSchema=z.object({
  joints:z.array(z.object({id:s,a:s,b:s,kind:z.literal("joined-by-proximity"),gapIn:n,grade})),
  taps:z.array(z.object({id:s,a:s,segment:n,kind:z.literal("tap-by-proximity"),gapIn:n,at:n,point:ns,grade})),
  inline:z.array(z.object({id:s,node:n,segment:n,kind:z.literal("inline-by-inference"),ports:z.tuple([s,s]),grade})),
  findings:z.array(z.object({id:s,kind:z.enum(["joined-by-proximity","tap-by-proximity","inline-by-inference","loop-by-inference","near-miss-across-classifications","missed-join","out-of-phase"]),elementIds:ns,note:s,grade:grade.nullable(),connectors:z.tuple([s,s]).optional(),gapIn:n.optional()})),
});
export const overridesReadSchema=z.object({terminalCfm:record(n).optional(),terminalPs:record(n).optional(),catalogLinks:record(z.object({table:s})).optional(),componentDrop:record(n).optional(),ruleAssignment:record(s).optional(),unitRole:record(z.enum(["fan","passive"])).optional(),unitCfm:record(n).optional(),designFrictionRate:n.optional()});
const drop=z.object({inWg:n,source:s.optional()}),flow=z.object({cfm:n,source:s.optional()});
export const stagedDuctsReadSchema=z.object({calculation:record(ductCalculationSchema),rules:record(z.object({table:s})),criteria:ductsCriteriaLayerSchema,kinds:record(z.object({kind:z.enum(DUCT_UNIT_KINDS)})),assumptions:record(ductAssumptionSchema),catalogs:record(z.object({table:s})),ruleAssignments:record(z.object({rule:s})),terminalDrops:record(drop),componentDrops:record(drop),esp:record(z.object({inWg:n})),equipmentFlows:record(flow),roles:record(z.object({role:z.enum(["fan","passive"])})),flows:record(flow),parameters:record(s),subject:record(ns),labelParameter:s.nullable(),workingPhase:s.nullable(),designFriction:n.nullable()});

