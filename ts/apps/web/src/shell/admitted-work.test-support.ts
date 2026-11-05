import type { AdmittedMount } from "./admitted-mount";

/** Await publication, not elapsed time; a refused feed must fail the fixture. */
export async function acceptedWork(mount: AdmittedMount) {
  let stop = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      const inspect = () => {
        if (mount.workFailure()) reject(Error(JSON.stringify(mount.workFailure())));
        else if (mount.workBasis()) resolve();
      };
      stop = mount.subscribe(inspect);
      inspect();
    });
  } finally {
    stop();
  }
}
