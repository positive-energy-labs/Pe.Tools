import { useEffect, useState } from "react";
import { Input } from "#/components/lang/input";

import { frac } from "./math";

/** Parses `5/8`, `1 1/2`, `0.625`. */
export function parseInches(s: string): number | null {
  const t = s.trim().replace(/[″"]/g, "");
  const m = /^(-?\d+)?\s*(?:(\d+)\/(\d+))?$/.exec(t);
  if (m && (m[1] || m[2])) {
    const whole = Number(m[1] ?? 0);
    const f = m[2] ? Number(m[2]) / Number(m[3]) : 0;
    return whole < 0 ? whole - f : whole + f;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Inch field: shows fractions, accepts fractions or decimals, commits on blur/Enter. */
export function InchField({
  value,
  onChange,
  int,
  style,
}: {
  value: number;
  onChange: (v: number) => void;
  int?: boolean;
  style?: React.CSSProperties;
}) {
  const show = int ? String(value) : frac(value);
  const [text, setText] = useState(show);
  useEffect(() => setText(show), [show]);
  const commit = () => {
    const v = parseInches(text);
    if (v === null || (int && !Number.isInteger(v))) return setText(show);
    onChange(v);
  };
  return (
    <Input
      style={style}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
