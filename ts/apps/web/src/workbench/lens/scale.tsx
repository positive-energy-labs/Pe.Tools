import { type ToolCall } from "../chat-state";

/** Document px → dial px. Lower = the whole thread packs into less rail. */
export const SCALE = 0.09;
export const FOCAL = 0.5;
export const MIN_BAND = 2;
export const HEAD_H = 40;

export interface Geom {
  key: string;
  turn: number;
  top: number;
  height: number;
}

export interface Moment {
  id: string;
  turn: number;
  role: "user" | "assistant" | "system";
  createdAt?: Date;
}

export interface TraceCell {
  key: string;
  call: ToolCall;
  parentId?: string;
}
