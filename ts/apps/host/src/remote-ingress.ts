import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { z } from "zod";
import { remoteIngressSchema } from "@pe/host-contracts/pe-api";
import { readStored } from "@pe/host-contracts/store";
import { storedNoticesPath } from "./notice-feed.ts";

const configSchema = z.strictObject({
  listenHost: z.union([z.ipv4(), z.ipv6()]),
  port: z.number().int().min(1).max(65535),
  origins: z
    .array(
      remoteIngressSchema.refine(({ origin }) => {
        const url = new URL(origin);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        );
      }),
    )
    .min(1),
});
/**
 * A person writes this file by hand, so it is `keep` (ADR 0039 rule 1): one that does not decode is
 * refused with a notice, its bytes stay, no remote listener opens, and the host starts.
 */
export function readRemoteIngress(path: string) {
  const read = readStored(path, configSchema, {
    class: "keep",
    place: "Remote ingress configuration",
    notices: storedNoticesPath(),
  });
  return read.kind === "ok" ? read.value : null;
}

/** A separate listener keeps SSH-forwarded loopback traffic outside the local human door. */
export function remoteListener(target: Server, requests: WeakSet<object>) {
  const server = createServer((request, response) => {
    requests.add(request);
    target.emit("request", request, response);
  });
  // Share uses the same response lifetime as the local listener; keep upload limits intact.
  server.setTimeout(0);
  // The private Revit bridge never crosses the remote listener.
  server.on("upgrade", (_request, socket) =>
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"),
  );
  return {
    async start(host: string, port: number) {
      server.listen(port, host);
      await once(server, "listening");
      return server.address();
    },
    async close() {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    },
  };
}
