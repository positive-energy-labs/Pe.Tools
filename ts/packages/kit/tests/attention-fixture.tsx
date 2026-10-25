import { useContext, useState, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import { AttentionDocument, useAttentionScope } from "../src/components/lang/attention";
export const kitRegistry = () => renderHook(() => useContext(RegistryContext)).result.current;
export function AttentionFixture({ children, doc = "kit" }: { children: ReactNode; doc?: string }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useAttentionScope(host);
  return (
    <AttentionDocument value={doc}>
      <div ref={setHost}>{children}</div>
    </AttentionDocument>
  );
}
