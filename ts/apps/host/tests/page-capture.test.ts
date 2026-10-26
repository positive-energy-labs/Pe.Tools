import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { expect, it } from "vite-plus/test";
import { publishPage } from "../src/page-publication.ts";
import { CaptureStore } from "../src/captures-route.ts";
import { createPagesHandler } from "../src/pages-route.ts";
import { servePeRoute } from "@pe/agent-contracts/pe-api";
import { asCaller, human } from "./callers.ts";

function pixel(png: Buffer, x: number, y: number) {
  const width = png.readUInt32BE(16),
    channels = png[25] === 6 ? 4 : 3;
  expect(png[24]).toBe(8);
  expect([2, 6]).toContain(png[25]);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  let previous = Buffer.alloc(width * channels);
  for (let row = 0; row <= y; row++) {
    const start = row * (previous.length + 1);
    const current = Buffer.from(raw.subarray(start + 1, start + 1 + previous.length));
    for (let column = 0; column < current.length; column++) {
      const left = column >= channels ? current[column - channels] : 0,
        up = previous[column],
        diagonal = column >= channels ? previous[column - channels] : 0;
      const estimate = left + up - diagonal;
      const a = Math.abs(estimate - left),
        b = Math.abs(estimate - up),
        c = Math.abs(estimate - diagonal);
      const predictor = [
        0,
        left,
        up,
        Math.floor((left + up) / 2),
        a <= b && a <= c ? left : b <= c ? up : diagonal,
      ][raw[start]];
      current[column] = (current[column] + predictor) & 255;
    }
    previous = current;
  }
  return [...previous.subarray(x * channels, x * channels + 3)];
}

it("renders the real public Page kit and settled animation pixels below the viewport", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-cdp-pixels-"));
  try {
    const root = join(home, "Pages");
    const captures = new CaptureStore(join(home, "captures"));
    const handler = asCaller(
      human,
      createPagesHandler(root, join(home, "Pods"), undefined, captures),
    );
    const html = `<!doctype html><html><head><title>Animation</title>
      <link rel="stylesheet" href="/pages/pe.css"><script src="/pages/pe.js"></script>
      <style>html,body{margin:0}#canvas{height:1600px;animation:settle 60s linear forwards}
      @keyframes settle{from{background:rgb(255,0,0)}to{background:rgb(0,255,0)}}</style>
      </head><body><div id="canvas"></div><script>
      pe.kitReady = pe.kitReady.then(() => { if (!pe.kit) throw Error('missing real kit'); });
      </script></body></html>`;
    const response = await servePeRoute(
      new Request("http://fixture/pe/pages/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "page", slug: "pixels", title: "Pixels", width: 320, html }),
      }),
      handler,
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const result = await response.json();
    const png = Buffer.from(result.capture.data, "base64");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 1600]);
    expect(result.capture.height).toBe(1600);
    expect(pixel(png, 160, 1500)).toEqual([0, 255, 0]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 45000);

it("denies actual loopback HTTP, CONNECT, WebSocket and worker egress but permits approved GETs", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-cdp-network-"));
  const requests: string[] = [];
  const trap = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.end("escaped");
  });
  trap.on("upgrade", (request, socket) => {
    requests.push(`UPGRADE ${request.url}`);
    socket.destroy();
  });
  trap.on("connect", (request, socket) => {
    requests.push(`CONNECT ${request.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", resolve));
  const address = trap.address();
  if (!address || typeof address === "string") throw Error("trap has no port");
  const origin = `http://127.0.0.1:${address.port}`;
  const libraries: string[] = [];
  const library = (path: string) => {
    libraries.push(path);
    return path === "/pages/pe.js"
      ? "/*preflight*/"
      : path === "/pages/approved.js"
        ? "approved"
        : null;
  };
  const root = join(home, "Pages");
  const captures = new CaptureStore(join(home, "captures"));
  await mkdir(join(root, "network"), { recursive: true });
  await writeFile(join(root, "network", "index.html"), "prior");
  const input = { kind: "page", slug: "network", title: "Network" };
  try {
    const script = `
      const socket=url=>new Promise((resolve,reject)=>{const ws=new WebSocket(url);ws.onerror=()=>resolve('blocked');ws.onopen=()=>{ws.close();reject(Error('WebSocket escaped'));};});
      const workerSource='onmessage=async(event)=>{const results=await Promise.all([fetch(event.data.http).then(()=>"escaped",()=>"blocked"),new Promise(resolve=>{const ws=new WebSocket(event.data.ws);ws.onerror=()=>resolve("blocked");ws.onopen=()=>resolve("escaped");})]);postMessage(results);}';
      const worker=new Worker(URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})));
      const worked=new Promise((resolve,reject)=>{worker.onerror=reject;worker.onmessage=event=>{worker.terminate();event.data.every(value=>value==='blocked')?resolve('worker computed'):reject(Error('worker egress'));};});
      worker.postMessage({http:'${origin}/worker-fetch',ws:'ws://127.0.0.1:${address.port}/worker-ws'});
      window.pe={kitReady:Promise.all([
        fetch('/pages/approved.js').then(r=>r.text()).then(text=>{if(text!=='approved')throw Error('approved GET failed');}),
        fetch('${origin}/post',{method:'POST'}).then(()=>{throw Error('POST escaped')},()=>null),
        fetch('http://localhost:${address.port}/foreign').then(()=>{throw Error('foreign GET escaped')},()=>null),
        fetch('https://127.0.0.1:${address.port}/connect').then(()=>{throw Error('CONNECT escaped')},()=>null),
        socket('ws://127.0.0.1:${address.port}/page-ws'),
        navigator.serviceWorker.register('/pages/sw.js').then(()=>{throw Error('service worker escaped')},()=>null),worked
      ])};`;
    const result = await publishPage(
      root,
      {
        ...input,
        html: `<!doctype html><html><head><title>Network</title></head><body><script>${script}</script></body></html>`,
      },
      origin,
      library,
      captures,
    );
    expect(result.ok).toBe(true);
    expect(libraries).toContain("/pages/approved.js");
    expect(libraries).not.toContain("/pages/sw.js");
    expect(requests).toEqual([]);
    const prior = await readFile(join(root, "network", "index.html"), "utf8");
    await expect(
      publishPage(
        root,
        {
          ...input,
          html: `<!doctype html><html><head>
      <link rel="stylesheet" href="${origin}/blocked.css"><script src="http://localhost:${address.port}/blocked.js"></script>
      <style>@font-face{font-family:blocked;src:url('${origin}/font.woff2')}body{font-family:blocked}</style>
      </head><body>Blocked assets<img src="${origin}/blocked.png"><audio src="${origin}/blocked.mp3" preload="auto"></audio></body></html>`,
        },
        origin,
        library,
        captures,
      ),
    ).rejects.toThrow("Preview");
    expect(await readFile(join(root, "network", "index.html"), "utf8")).toBe(prior);
    expect(requests).toEqual([]);
  } finally {
    trap.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      trap.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(home, { recursive: true, force: true });
  }
}, 60000);
it("refuses uncaught runtime errors in self-contained workers", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-cdp-worker-error-"));
  try {
    await mkdir(join(home, "Pages", "worker-error"), { recursive: true });
    await writeFile(join(home, "Pages", "worker-error", "index.html"), "prior");
    await expect(
      publishPage(
        join(home, "Pages"),
        {
          kind: "page",
          slug: "worker-error",
          title: "Worker error",
          html: `<!doctype html><html><head><title>Worker error</title></head><body><script>
        const worker = new Worker(URL.createObjectURL(new Blob(["throw Error('worker capture refused')"], {type:'text/javascript'})));
        window.pe = {kitReady: new Promise(resolve => worker.onerror = () => resolve(null))};
        </script></body></html>`,
        },
        "http://fixture",
        () => null,
        new CaptureStore(join(home, "captures")),
      ),
    ).rejects.toThrow("worker capture refused");
    expect(await readFile(join(home, "Pages", "worker-error", "index.html"), "utf8")).toBe("prior");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 45000);
