import { createContext, useContext } from "react";
export interface TakeoffCellControls {
  control(id: string, input: { segment: string | null; key: string }): {
    refusal: string | null; label: string;
    run(): Promise<{ state?: string; refusal?: { code: string; message: string } }>;
  };
}
export const TakeoffKernel = createContext<TakeoffCellControls | null>(null);
export const useTakeoffKernel = () => useContext(TakeoffKernel);
