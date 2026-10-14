import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { remoteIngressSchema } from "@pe/host-contracts/pe-api";

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
export const readRemoteIngress = (path: string) =>
  existsSync(path) ? configSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : null;

/** A separate listener keeps SSH-forwarded loopback traffic outside the local human door. */
export function remoteListener(target: Server, requests: WeakSet<object>) {
  const server = createServer((request, response) => {
    requests.add(request);
    target.emit("request", request, response);
  });
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
