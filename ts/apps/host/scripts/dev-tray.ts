import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { createDevTraySupervisor } from "./dev-tray-supervisor.ts";

const root = checkoutRootFrom(import.meta.dirname);
if (!root) throw new Error("Dev tray must start from a Pe.Tools checkout");
const supervisor = await createDevTraySupervisor(root, process.argv.includes("--show"));
if (!supervisor) console.log("This checkout already has a dev tray supervisor.");
else {
  await Promise.race([
    supervisor.stopped,
    new Promise<void>((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    }),
  ]);
  await supervisor.stop();
}
