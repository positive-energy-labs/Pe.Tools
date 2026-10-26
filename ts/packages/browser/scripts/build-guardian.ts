import { buildWindowsGuardian } from "../src/native-guardian.ts";

/** The VersionedApp payload transports this entire directory beside its SEA executable. */
export function browserGuardianPlugin(directory: string) {
  return {
    name: "stage-native-browser-guardian",
    async closeBundle() {
      await buildWindowsGuardian(directory);
    },
  };
}
