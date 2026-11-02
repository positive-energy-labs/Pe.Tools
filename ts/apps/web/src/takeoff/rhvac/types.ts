export interface TakeoffResidueShape {
  id: string;
  reason: "border" | "crumb" | "rejected" | "excluded";
  claimed?: boolean;
  rawSqft: number;
  meanCeilingFt: number;
  label: [number, number];
  outer: [number, number][];
  holes: [number, number][][];
}
