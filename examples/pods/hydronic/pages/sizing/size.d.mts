import type { MepSegmentSizes, MepSystemMembers } from "@pe/host-contracts/generated";
/** Pure sizing: everything the product decides, with no Revit and no kernel. */
export type Pipe = {
    uniqueId: string;
    label: string;
    /** Design flow, L/s; null when the model carries none. */
    flow: number | null;
    /** Current nominal diameter, mm. */
    diameter: number;
    length: number;
    /** Upstream pipe, or null at the pump; the head walk assumes a tree. */
    upstream: string | null;
    /** Pipe segment UniqueId; its sizes are this pipe's catalog. */
    segment: string | null;
};
export type Size = {
    nominal: number;
    inner: number;
};
export type Limits = {
    maxVelocity: number;
    maxFriction: number;
};
export type Status = "ok" | "undersized" | "oversized" | "no-flow";
export type Closer = {
    uniqueId: string;
    kind: "no-flow" | "exceeds-limit" | "no-catalog-size";
};
/** Velocity (m/s) and Darcy friction (Pa/m) of `flow` L/s through `inner` mm. */
export declare function hydraulics(flow: number, inner: number): {
    velocity: number;
    friction: number;
};
/** One row per pipe and the unresolved list; the pump head stays greyed until that list is empty. */
export declare function size(pipes: readonly Pipe[], catalogs: Readonly<Record<string, readonly Size[]>>, limits: Limits, chosen: Readonly<Record<string, number>>, rooted?: boolean): {
    rows: (Pipe & { candidate: number | null; chosen: number | null; status: Status })[];
    unresolved: Closer[];
    pumpHead: {
        pa: number | null;
        greyed: boolean;
    };
};
/** Revit's read (internal feet and cfs) into pipes in mm, L/s and m, rooted by a walk across connector
 * peers from the source's base connector: Revit reports Bidirectional there, so direction cannot root it.
 * `rooted` is false when a pipe is not reached from the source; the pump head then stays greyed. */
export declare function fromRevit(read: MepSystemMembers.Res.Response, segments: MepSegmentSizes.Res.Response): {
    pipes: Pipe[];
    catalogs: Record<string, Size[]>;
    rooted: boolean;
};
