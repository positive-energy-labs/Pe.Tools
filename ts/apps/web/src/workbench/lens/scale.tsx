import { type ToolCall } from "../chat-state";

export const SCALE = 0.14;
export const FOCAL = 0.5;
export const MIN_BAND = 3;
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
