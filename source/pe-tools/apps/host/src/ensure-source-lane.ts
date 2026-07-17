import { isSea } from "node:sea";

// Lane is the SDK-owned PE_LANE signal (see host-ownership.ts resolveHostLane, which fails fast
// when it is absent). A host running from un-bundled TypeScript source (jiti / `vp run
// @pe/host#dev` / `pnpm dev`) is definitionally the dev lane; the installed lane is ALWAYS the
// SEA-compiled Pe.Host.exe, where InstalledService sets PE_LANE=installed on spawn. Declaring dev
// here — only outside the SEA and only when PE_LANE is unset — keeps the developer launch paths
// working without weakening the installed lane's PE_LANE authority (isSea() is true in the bundle,
// so this never fires there, and an explicit PE_LANE always wins). Import this FIRST from every
// source entry point, before host-ownership evaluates the lane at module load.
if (!isSea() && !process.env.PE_LANE) process.env.PE_LANE = "dev";
