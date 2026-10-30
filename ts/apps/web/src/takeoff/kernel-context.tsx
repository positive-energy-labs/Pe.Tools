import { createContext, useContext } from "react";
import type { TakeoffMount } from "./store";
export const TakeoffKernel = createContext<TakeoffMount | null>(null);
export const useTakeoffKernel = () => useContext(TakeoffKernel);
