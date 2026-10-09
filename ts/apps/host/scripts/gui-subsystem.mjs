// The packed host is a Node SEA, and Node's apphost is a console-subsystem image: started from the
// HKCU Run value at login, from the Start Menu shortcut, or by the installer stub, Windows gives it
// its own console window, and closing that window kills the host and its tray. Flip the PE
// optional-header Subsystem from CUI (3) to GUI (2) after pack and before signing. Node provides a
// black-hole stdout/stderr when no console exists; the installed lane tees its console to
// logs/host.log anyway (host-main.ts). Redirected pipes (the --adapter child, the SDK launcher's
// service log) are unaffected by the subsystem.
import assert from "node:assert/strict";
import { openSync, readSync, writeSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exe = resolve(dirname(fileURLToPath(import.meta.url)), "../dist-installed/Pe.Host.exe");
const fd = openSync(exe, "r+");
try {
  const dos = Buffer.alloc(64);
  readSync(fd, dos, 0, 64, 0);
  assert.equal(dos.toString("latin1", 0, 2), "MZ", `${exe} is not a PE image`);
  const peOffset = dos.readUInt32LE(0x3c);
  const head = Buffer.alloc(4 + 20);
  readSync(fd, head, 0, head.length, peOffset);
  assert.equal(head.toString("latin1", 0, 4), "PE\0\0", `${exe} has no PE signature`);
  // Subsystem is at offset 68 of the optional header for both PE32 and PE32+.
  const subsystemOffset = peOffset + 4 + 20 + 68;
  const subsystem = Buffer.alloc(2);
  readSync(fd, subsystem, 0, 2, subsystemOffset);
  const current = subsystem.readUInt16LE(0);
  assert.ok(current === 3 || current === 2, `${exe} has an unexpected subsystem ${current}`);
  writeSync(fd, Buffer.from([2, 0]), 0, 2, subsystemOffset);
  console.log(`Pe.Host.exe subsystem ${current === 3 ? "CUI -> GUI" : "already GUI"}`);
} finally {
  closeSync(fd);
}
