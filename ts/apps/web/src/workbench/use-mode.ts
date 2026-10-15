import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Mode } from "./depth";

export function useMode(): [Mode, (mode: Mode) => void] {
  const { mode } = useSearch({ from: "/pea" });
  const navigate = useNavigate({ from: "/pea" });
  const setMode = (next: Mode) => {
    void navigate({ search: (prev) => ({ ...prev, mode: next }) });
  };
  return [mode as Mode, setMode];
}
