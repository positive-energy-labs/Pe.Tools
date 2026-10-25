import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function fixtureServer() {
  const html = await readFile(new URL("./page.html", import.meta.url));
  const requests: string[] = [];
  const sessionCookie = `pe_fixture_auth=${randomUUID()}`;
  const authRequests: {
    path: string;
    method: string;
    authenticated: boolean;
    fetchUser?: string;
  }[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/sign-in" && request.method === "POST") {
      authRequests.push({
        path: request.url,
        method: request.method,
        authenticated: false,
        fetchUser: request.headers["sec-fetch-user"] as string | undefined,
      });
      response.writeHead(303, {
        location: "/account",
        "set-cookie": `${sessionCookie}; HttpOnly; SameSite=Lax; Max-Age=3600; Path=/`,
      });
      response.end();
    } else if (request.url === "/account") {
      const authenticated = request.headers.cookie?.split("; ").includes(sessionCookie) ?? false;
      authRequests.push({ path: request.url, method: request.method ?? "GET", authenticated });
      response.writeHead(authenticated ? 200 : 401, { "content-type": "text/html" });
      response.end(
        authenticated ? "<h1>Signed in as fixture-operator</h1>" : "<h1>Sign-in required</h1>",
      );
    } else if (request.url === "/disconnect") {
      request.socket.destroy();
    } else if (request.url === "/download") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="fixture.txt"',
      });
      response.end("Pe native download\n");
    } else if (request.url === "/resource") {
      response.end("Resource loaded");
    } else if (request.url === "/frame") {
      response.setHeader("content-type", "text/html");
      response.end(
        "<button id=\"frame-button\" onclick=\"this.textContent=event.isTrusted?'Frame trusted':'Frame untrusted'\">Frame action</button>",
      );
    } else if (request.url === "/popup") {
      response.setHeader("content-type", "text/html");
      response.end("<h1>Native popup</h1>");
    } else {
      response.setHeader("content-type", "text/html");
      response.end(html);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    authRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
