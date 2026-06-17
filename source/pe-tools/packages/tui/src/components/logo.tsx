import type { JSX } from "@opentui/solid";
import { peaTheme } from "../theme.js";

const peaLogo = [
  "                   ",
  "█▀▀█ █▀▀▀  █▀▀█",
  "█__█ █___  █__█",
  "█▀▀▀ █▀▀▀  █^^█",
  "▀    ▀▀▀▀  ▀  ▀",
];

export function Logo(): JSX.Element {
  return (
    <box flexDirection="column" alignItems="center" gap={0}>
      {peaLogo.map((line, index) => (
        <text fg={index % 2 === 0 ? peaTheme.primary : peaTheme.accent}>{line}</text>
      ))}
      <text fg={peaTheme.textMuted}>Revit operator workbench</text>
    </box>
  );
}
