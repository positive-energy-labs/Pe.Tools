import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Mode } from "./depth";

/** Mode is URL-canonical: read from the `mode` search param, write through navigate. */
export function useMode(): [Mode, (mode: Mode) => void] {
  const { mode } = useSearch({ from: "/chat" });
  const navigate = useNavigate({ from: "/chat" });
  const setMode = (next: Mode) => {
    void navigate({ search: (prev) => ({ ...prev, mode: next }) });
  };
  return [mode as Mode, setMode];
}
