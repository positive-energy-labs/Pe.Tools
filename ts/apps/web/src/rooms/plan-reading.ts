export type { RoomsPlanReading as PlanReading } from "@pe/agent-contracts";
import type { RoomsPlanReading } from "@pe/agent-contracts";
export type PlanImage = Extract<NonNullable<RoomsPlanReading>, { plan: unknown }>["plan"];
export type PlanRefusal = Extract<NonNullable<RoomsPlanReading>, { refusal: unknown }>["refusal"];
