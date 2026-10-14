/* pe.js — a page's doors into Revit. One script tag, one global:
 *
 *   <script src="/pages/pe.js"></script>
 *   await pe.target();                                   // the document this page's binding names: { session, openId, title }
 *   await pe.find("show elements");                      // the host's catalog ranked by words → [{ key, kind, title, description }]
 *   await pe.read("revit.context.summary");              // run a read on the bound document; the answer is the op's response
 *   await pe.do("revit.context.show-elements", { elementIds: [1234] });   // run a mutation as this page; waits until it settles
 *   await pe.script("checks/census.csx");                // run C# in Revit: a source string, or a .cs/.csx path beside the page
 *   await pe.do("script:@snowdon-ducts/src/Census.cs");  // run a package's declared script on the bound document
 *   await pe.state(kernel);                              // share a kit kernel's event log with every copy and every agent
 *   pe.describe(() => `# ${kernel.state.title}`);        // what the page says, as markdown, kept beside the snapshot for agents
 *   await pe.picture([1234]);                            // lens then view-image: { url, sha, at, viewId, viewName, registration }
 *   await pe.reading("checks/census.csx", run);          // one reading: { source, at, rows } with rows = what `run()` answered
 *   await pe.diff([1234], ["Mark"], run);                // read the parameters, run, read again: the rows that changed
 *
 * `find`, `read` and `do` are the same words and keys as Pea's `pe_find`, `pe_read` and `pe_do`. The host knows which
 * page is calling from the page's own path (`pe.page` is the key it minted) and which document from the page's
 * binding, set with the chip in the corner (Bind… opens the picker in the app). A page never names its own origin or
 * target. Reads run on the bound document; a write runs as this page under the binding: a thread binding writes
 * with that thread's rw grant, a pinned document only when it is Pea's own. Anything the host refuses is thrown with
 * the host's words and shown across the top of the page.
 *
 * The host refuses a browser request that does not name the runtime that served the page. Every door here names
 * it; a page's own request to its host goes through `pe.fetch(url, init)` (same signature as `fetch`).
 */
(() => {
  // The serving host writes `{ header, query, service }` here (pages-route), so the page names the runtime that
  // served it, like the web app's `hostFetch`: a host that later takes over the port refuses this copy.
  const RUNTIME = /*pe:runtime*/ null;
  if (!RUNTIME) throw new Error("pe.js was not served by a Pe host; load it from /pages/pe.js");
  const pe = {
    /** The page's slug, from its URL. */
    slug: (location.pathname.match(/^\/pages\/([^/]+)/) || [])[1] || "",
    /** The page key the host minted into `<meta name="pe-page">`: `page:@pages/<slug>` or `page:@<pod>/pages/<page>`. */
    page:
      (typeof document !== "undefined" &&
        document.querySelector?.('meta[name="pe-page"]')?.getAttribute("content")) ||
      null,
    /** The bound document `{ session, openId, title }`, after `pe.target()`. */
    doc: null,
  };
  const pageInput = (body) => ({
    params: { slug: pe.slug },
    ...(body === undefined ? {} : { body }),
  });
  /** The bind chip, drawn once the page has a body (below). */
  let chip = null;
  /** `fetch` that names this page's runtime on same-origin requests; the host refuses a browser request without it. */
  pe.fetch = (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
      location.href,
    );
    if (url.origin !== location.origin) return fetch(input, init);
    const h = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    h.set(RUNTIME.header, RUNTIME.service);
    return fetch(input, { ...init, headers: h });
  };
  const client = /*pe:client*/ null;
  // EventSource cannot send headers: the runtime rides the query, as the web app's `runtimeStreamUrl` does.
  const streamUrl = (path) => {
    const url = new URL(path, location.href);
    url.searchParams.set(RUNTIME.query, RUNTIME.service);
    return url.href;
  };
  /** The host's refusal across the top of the page, word for word; one banner, the latest refusal. */
  const banner = (message) => {
    if (typeof document === "undefined" || !document.body) return;
    let note = document.getElementById("pe-refusal");
    if (!note) {
      note = document.createElement("div");
      note.id = "pe-refusal";
      note.setAttribute("role", "alert");
      note.style.cssText =
        "position:sticky;top:0;z-index:2147483647;padding:8px 12px;background:#7f1d1d;color:#fff;font:13px/1.4 system-ui,sans-serif;white-space:pre-wrap";
      document.body.prepend(note);
    }
    note.textContent = message;
  };
  /**
   * The host's own refusal, word for word, is the error message. A door refusal (`refusal.code`, e.g. `grant.required`,
   * `page.unbound`) or a binding that names no one document (`resolution`, `choose: ambiguous`) is also shown on the
   * page and carried on the error as `code`, `refusal` and `resolution`.
   */
  const fail = async (r, body) => {
    const b = body === undefined ? await r.text().catch(() => "") : body;
    let m = typeof b === "string" ? b : "";
    let j = null;
    try {
      j = typeof b === "string" ? JSON.parse(b) : b;
      if (j.error && typeof j.error === "object")
        j = { ...j.error.details, message: j.error.message };
      m = j.message || j.error || j.title || m;
    } catch {}
    const error = new Error(`${r.status} ${r.statusText}${m ? `: ${m}` : ""}`);
    if (j && (j.refusal || j.resolution)) {
      Object.assign(error, {
        name: "PeRefusal",
        code: j.refusal ? j.refusal.code : j.resolution.reason || j.resolution.kind,
        refusal: j.refusal || null,
        resolution: j.resolution || null,
      });
      banner(m);
    }
    throw error;
  };
  // A capture's URL rides a response header (`x-pe-capture-url`); it is copied onto the answer so a page can `<img src>` it.
  const json = async (r) => {
    if (!r.ok) return fail(r);
    const body = await r.json();
    const capture = r.headers.get("x-pe-capture-url");
    if (capture && body && typeof body === "object")
      Object.assign(body, { captureUrl: capture, captureId: r.headers.get("x-pe-capture-id") });
    return body;
  };

  /** The host's reading of this page's default slot: binding, resolution, document, and what a write would do. */
  const readTarget = async () => {
    const reading = await json(await client.response("page.target", pageInput()));
    pe.doc = reading.document;
    chip?.show(reading);
    return reading;
  };

  /**
   * The document this page's binding names, as the host resolves it now; sets `pe.doc`. A binding that names no one
   * document (no binding, a pinned file open twice or closed, a thread pointed nowhere) is thrown as a
   * `PeTargetRefusal` with the resolver's word as `code` (`ambiguous`, `document-closed`, `session-gone`, `missing`)
   * and shown on the page; nothing is ever picked for it. Bind the page from the chip.
   */
  pe.target = async (...selector) => {
    // A page no longer names its target; a selector here would be silently ignored, so it is refused.
    if (selector.length)
      throw new Error(
        "pe.target takes no selector: the page's binding names its document (Bind… on the chip)",
      );
    const reading = await readTarget();
    if (reading.resolution.kind === "resolved") return pe.doc;
    const code = reading.resolution.reason || reading.resolution.kind;
    const error = new Error(
      `pe.target: this page's binding names no one document (${code}). Bind it from the chip.`,
    );
    Object.assign(error, { name: "PeTargetRefusal", code, resolution: reading.resolution });
    banner(error.message);
    throw error;
  };

  /**
   * Find catalog rows by words, exactly as `pe_find` and the `@` menu do: the host's one catalog and ranker answer,
   * in its order (`/pe/capabilities`). `kind` narrows (`op`, `script`, `page`, `skill`, `member`, ...). Rows are
   * `{ key, kind, title, description }`; `pe.do(row.key)` runs an `op:` or `script:` row.
   */
  pe.find = async (words = "", { kind } = {}) => {
    const q = new URLSearchParams({ query: words });
    if (kind) q.set("kind", kind);
    if (pe.doc) q.set("session", pe.doc.session);
    const { capabilities } = await json(
      await client.response("capabilities.find", { query: Object.fromEntries(q) }),
    );
    return capabilities.map(({ key, kind, title, description }) => ({
      key,
      kind,
      title,
      description,
    }));
  };

  /** Run a read on the bound document (`/pages/<slug>/call`). A mutation is refused here by the host; use `pe.do`. */
  pe.read = async (key, request = {}) =>
    json(await client.response("page.call", pageInput({ key, request })));

  /**
   * Run any op. A read answers at once on the bound document; a mutation runs as this page through
   * `/pages/<slug>/act`, under the binding (the bound thread's rw grant, or Pea's own document for a pin), and this
   * waits until its receipt settles. The answer is the op's response either way. A package script key
   * (`script:@snowdon-ducts/src/Census.cs`) always acts: it runs that package's declared script on the binding's
   * document, as this page; `input` passes only `permissionMode` and `timeoutSeconds`.
   */
  pe.do = async (key, input = {}) => {
    if (!key.startsWith("script:")) {
      const r = await client.response("page.call", pageInput({ key, request: input }));
      if (r.ok) return json(r);
      const wire = await r.json().catch(() => null);
      const answer = wire?.error?.details ?? wire;
      // Only "this is a mutation" moves on to act; a binding that names no one document stops here.
      if (!(r.status === 409 && answer && answer.notDispatched && !answer.resolution))
        return fail(r, answer ?? "");
    }
    let row = await json(await client.response("page.act", pageInput({ key, input })));
    const id = row.id;
    while (row.state === "running") {
      await new Promise((ok) => setTimeout(ok, 250));
      [row = row] = await json(await client.response("actions.read", { query: { id } }));
    }
    if (row.state !== "succeeded")
      throw new Error(`${key} ${row.state}: ${row.message || row.error || ""}`.trim());
    return row.result;
  };

  /**
   * Run C# in Revit (`scripting.execute`): Execute-body statements with `doc`, `uidoc`, `app`, `selection` in scope
   * and `Result(value)` as the answer. `source` is the C#, or a one-line `.cs`/`.csx` path fetched relative to the
   * page (`checks/census.csx` is the file beside index.html). `mode` is ReadOnly (default; every change rolls back),
   * WriteTransaction (one host-owned transaction) or NoTransaction (the script owns its transactions). Throws with
   * the compiler's or the runtime's own message when the script did not succeed; otherwise answers what
   * `Result(...)` was given.
   */
  pe.script = async (source, { mode = "ReadOnly", timeoutSeconds = 120 } = {}) => {
    let scriptContent = source;
    if (!source.includes("\n") && /\.csx?$/i.test(source)) {
      const r = await pe.fetch(new URL(source, location.href), { cache: "no-store" });
      if (!r.ok) return fail(r);
      scriptContent = await r.text();
    }
    const run = await pe.do("scripting.execute", {
      scriptContent,
      permissionMode: mode,
      timeoutSeconds,
    });
    if (run.status !== "Succeeded") {
      const why = (run.diagnostics || [])
        .filter((d) => d.severity === "Error")
        .map((d) => d.message.split("\n")[0])
        .join("; ");
      throw new Error(
        `script ${run.status}${why ? `: ${why}` : ""}${run.output ? `\n${run.output}` : ""}`,
      );
    }
    return run.data ?? run.result ?? null;
  };

  /**
   * A picture of elements the agent can cite: `revit.context.lens` boxes a 3D view around them (a mutation, through
   * `pe.do`), then `revit.context.view-image` exports that view cropped to them (a read). The host keeps the PNG once
   * per sha at `url`; `registration` places its pixels in model XY (null when the host refused to register it).
   */
  // TODO: with `focus` set, view-image crops to the elements alone; one 7 in elbow came back as two unreadable arcs (pdrop-tour walk, 2026-10-05). Widen the crop (margin, or focus off and the lens box only) so a person can tell what they are looking at.
  pe.picture = async (elementIds, { name, paddingFeet, pixelSize, marginPercent } = {}) => {
    const lens = await pe.do("revit.context.lens", { elementIds, name, paddingFeet });
    const image = await pe.read("revit.context.view-image", {
      target: { id: lens.viewId },
      focus: { elementIds },
      pixelSize,
      marginPercent,
    });
    const url = image.captureUrl || image.imageUrl;
    if (!url) throw new Error(`view-image of ${lens.viewName} was not kept by the host`);
    return {
      url,
      sha: (url.match(/([a-f0-9]{64})/i) || [])[1] || null,
      at: Date.now(),
      viewId: lens.viewId,
      viewName: lens.viewName,
      registration: image.registration || null,
    };
  };

  /** One reading: `rows` is whatever `run()` answers, `source` is the page's name for where it came from (an op key, a script path). */
  pe.reading = async (source, run) => {
    const rows = await run();
    return { source, at: Date.now(), rows };
  };

  /**
   * What a write changed: the named parameters of the elements are read (`revit.detail.elements`), `run()` runs, and
   * they are read again. Values compare on Revit's raw value and show as Revit displays them, so a change hidden by
   * the document's units precision still counts. Answers `{ rows: [{ id, parameter, before, after }], unchanged }`.
   */
  pe.diff = async (elementIds, parameterNames, run) => {
    const read = async () => {
      const { entries } = await pe.read("revit.detail.elements", {
        query: {
          kind: "ElementReferences",
          elementIds,
          parameterQuery: { parameters: parameterNames.map((name) => ({ name })) },
        },
      });
      const values = new Map();
      for (const e of entries)
        for (const p of e.requestedParameters || [])
          values.set(`${e.elementId}\n${p.name}`, {
            raw: p.rawValue ?? p.value ?? null,
            shown: p.displayValue ?? p.value ?? null,
          });
      return values;
    };
    const before = await read();
    await run();
    const after = await read();
    const rows = [];
    let unchanged = 0;
    for (const [key, a] of after) {
      const b = before.get(key);
      if (b && b.raw === a.raw) unchanged++;
      else {
        const [id, parameter] = key.split("\n");
        rows.push({ id: Number(id), parameter, before: b ? b.shown : null, after: a.shown });
      }
    }
    return { rows, unchanged };
  };

  /**
   * The page's text projection: `fn()` answers markdown describing what the page shows now. `pe.state` writes it
   * beside the snapshot after every change, so `GET /pages/<slug>/state` tells an agent what the page says.
   */
  let describe = null;
  pe.describe = (fn) => {
    describe = fn;
  };

  /**
   * The smallest kernel: `reduce(state, event)` over a log. `fire` applies one event and renders (false when nothing
   * changed), `replay` rebuilds from a base. Hand the result to `pe.state` to share it.
   */
  pe.kernel = (reduce, base, render = () => {}) => {
    const k = { state: base, base, log: [] };
    k.fire = (ev) => {
      const next = reduce(k.state, ev);
      if (next === k.state) return false;
      k.log.push(ev);
      k.state = next;
      render(next);
      return true;
    };
    k.replay = (events, from = base) => {
      k.state = from;
      k.log = [];
      for (const ev of events) {
        const next = reduce(k.state, ev);
        if (next !== k.state) (k.log.push(ev), (k.state = next));
      }
      render(k.state);
      return k;
    };
    return k;
  };

  /**
   * Share a kit kernel's event log through the host. Replays the saved log into `k`, sends every later `k.fire`
   * to `/pages/<slug>/events`, follows other copies and agents live, and keeps `/pages/<slug>/state`'s snapshot
   * current. Event types in `local` stay in this copy; hash navigation (`nav`) always does. Resolves to `k` once
   * the replay is in.
   */
  pe.state = async (k, { local = [] } = {}) => {
    const isLocal = (ev) => ev.type === "nav" || local.includes(ev.type);
    const mine = new Set();
    let seq = 0;
    let timer;
    const snapshot = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        client.response("page.snapshot", pageInput(k.state)).catch(() => {});
        if (describe)
          client.response("page.text", pageInput(String(describe(k.state)))).catch(() => {});
      }, 150);
    };
    const saved = await json(await client.response("page.state", pageInput()));
    seq = saved.seq;
    k.replay(
      saved.events.map((row) => row.event),
      k.base,
    ); // from the kernel's base, so the URL's view state survives the replay
    const fire = k.fire;
    k.fire = (ev) => {
      if (isLocal(ev)) return fire(ev);
      ev.eventId ||= crypto.randomUUID(); // ours, so the echo over SSE is skipped; `id` stays the page's own
      if (!fire(ev)) return false;
      mine.add(ev.eventId);
      snapshot();
      client
        .response("page.append", pageInput(ev))
        .then(json)
        .then((row) => (seq = Math.max(seq, row.seq)))
        .catch((e) => console.error("pe.state: the host did not keep an event", e));
      return true;
    };
    // A browser's own EventSource retry was seen to never fire after a dev host restart (2026-10-04), so the
    // stream is replaced by a watchdog: on error, when it never opens, or when the host's heartbeat (every 15 s)
    // stops. It resumes from the last seq seen; nothing is lost, the host replays.
    let retryMs = 1000;
    let heard = Date.now();
    const follow = () => {
      const es = new EventSource(
        streamUrl(client.url("page.events", { ...pageInput(), query: { after: seq } })),
      );
      heard = Date.now();
      es.onopen = () => ((retryMs = 1000), (heard = Date.now()));
      es.addEventListener("ping", () => (heard = Date.now()));
      es.onmessage = (m) => {
        heard = Date.now();
        const row = JSON.parse(m.data);
        seq = Math.max(seq, row.seq);
        if (mine.delete(row.event.eventId)) return; // our own fire, already applied
        if (fire(row.event)) snapshot();
      };
      const replace = () => {
        es.close();
        clearInterval(watch);
        setTimeout(follow, retryMs);
        retryMs = Math.min(retryMs * 2, 10000);
      };
      es.onerror = replace;
      const watch = setInterval(() => {
        if (Date.now() - heard > (es.readyState === 1 ? 45000 : 10000)) replace();
      }, 2000);
      pe.events = es;
    };
    follow();
    // ponytail: undo stays local to one copy; a shared undo is an event of its own when a page needs it.
    return k;
  };

  /**
   * The bind chip: host-owned, drawn in its own shadow root in the corner of every page (page CSS never reaches it),
   * styled by pe.css. It shows what the binding names and what a write would do (`rw · 42m` counted from the host's
   * clock, `pea`, or `read` with the host's reason), and Bind… opens the picker in the app, where a person binds.
   */
  chip = (() => {
    if (!pe.slug || typeof document === "undefined" || !document.createElement) return null;
    const host = document.createElement("pe-bind");
    if (typeof host.attachShadow !== "function") return null;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<link rel="stylesheet" href="/pages/pe.css"><div class="pe-bind"><span class="pe-bind-write"></span><span class="pe-bind-what"></span><button type="button">Bind…</button></div>';
    const face = root.querySelector(".pe-bind");
    const [write, what] = face.querySelectorAll("span");
    root.querySelector("button").onclick = () =>
      window.open(`/bind?page=${encodeURIComponent(pe.slug)}`, "pe-bind");
    const mount = () => document.body.append(host);
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);
    let reading = null;
    const draw = () => {
      if (!reading) return;
      const { binding, resolution, document: doc } = reading;
      const w = reading.write;
      const mark = !w
        ? "—"
        : w.kind === "rw"
          ? `rw · until ${new Date(w.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : w.kind;
      face.dataset.write = mark.startsWith("rw") ? "rw" : mark;
      face.dataset.state = resolution.kind;
      write.textContent = mark;
      write.title = w && w.kind === "read" ? w.refusal.reason : "";
      const named =
        binding.kind === "thread"
          ? `thread ${binding.thread.slice(0, 8)}`
          : binding.kind === "pinned"
            ? "pinned"
            : "unbound";
      const subject =
        resolution.kind === "resolved"
          ? doc
            ? doc.title
            : ""
          : resolution.kind === "choose"
            ? `choose: ${resolution.reason}`
            : resolution.kind;
      what.textContent = subject ? `${named} · ${subject}` : named;
    };
    // Nothing polls: the host pushes `binding` (the picker, another tab), `head` (a thread's head moved in chat) and
    // `file` on this page's stream; a grant's expiry is read again at its own minute. A dropped stream reopens.
    let expiry = 0;
    const fresh = () => readTarget().catch(() => {});
    const follow = () => {
      // Live only: the log's rows belong to `pe.state`.
      const es = new EventSource(
        streamUrl(
          client.url("page.events", { ...pageInput(), query: { after: Number.MAX_SAFE_INTEGER } }),
        ),
      );
      es.onopen = fresh;
      es.addEventListener("head", fresh);
      es.addEventListener("binding", fresh);
      // A tab never learned its page file changed, so a stale copy ran old code: kaitpw pressed pre-fix buttons for
      // two hours while the fix was on disk (2026-10-05). A changed page, script or style reloads it.
      es.addEventListener("file", (m) => {
        if (/\.(html|m?js|css)$/i.test(JSON.parse(m.data).path)) location.reload();
      });
      es.onerror = () => {
        es.close();
        setTimeout(follow, 2000);
      };
      window.addEventListener("pagehide", () => es.close(), { once: true });
    };
    follow();
    window.addEventListener("focus", fresh);
    return {
      show(next) {
        reading = next;
        clearTimeout(expiry);
        if (next.write && next.write.kind === "rw")
          expiry = setTimeout(
            fresh,
            Math.max(0, Date.parse(next.write.expiresAt) - Date.now()) + 500,
          );
        draw();
      },
    };
  })();

  window.pe = pe;
})();
