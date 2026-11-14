/* pe.js — a page's doors into Revit. One script tag, one global:
 *
 *   <script src="/pages/pe.js"></script>
 *   await pe.target();                                   // the document this page's binding names: { session, openId, title }
 *   await pe.find("show elements");                      // the host's catalog ranked by words → [{ key, kind, title, description }]
 *   await pe.read("revit.context.summary");              // run a read on the bound document; the answer is the op's response
 *   await pe.do("revit.context.show-elements", { elementIds: [1234] });   // run a mutation as this page; waits until it settles
 *   await pe.script("checks/census.csx", { input: { level: "L2" } });   // run the Pod's declared script; the answer is its Result(...)
 *   await pe.do("script:@snowdon-ducts/src/Census.cs");  // the same call by key, the key Pea runs too
 *   const k = await pe.state({ reduce, base, render, describe }); // one shared event log
 *   // Declare agent events in HTML: <script type="application/json" id="pe-agent">{"verdict":"passed and explanation"}</script>
 *   await pe.picture([1234]);                            // lens then view-image: { url, sha, at, viewId, viewName, registration }
 *   await pe.reading("checks/census.csx", run);          // one reading: { source, at, rows } with rows = what `run()` answered
 *   await pe.diff({ script: "heals/taps.csx" }, ["Mark"]);   // run it and answer what it changed: elements and before/after rows
 *
 * `find`, `read` and `do` are the same words and keys as Pea's `pe_find`, `pe_read` and `pe_do`. The host knows which
 * page is calling from the page's own path (`pe.page` is the key it minted) and which document from the page's
 * binding, set with the chip in SPA chrome (Bind… opens the picker in the app). A page never names its own origin or
 * target. Reads run on the bound document; a write runs as this page under the binding: a thread binding writes
 * on a document a human added to that thread, a pinned document only when it is Pea's own. Anything the host refuses is thrown with
 * the host's words and shown across the top of the page.
 *
 * The host refuses a browser request that does not name the runtime that served the page. Every door here names
 * it; a page's own request to its host goes through `pe.fetch(url, init)` (same signature as `fetch`).
 */
(() => {
  /*pe:offline-state:start*/
  // The export embeds this same reducer/replay path with an offline transport.
  // reduce(state, event, { origin, seq, at }); declare agent events in script#pe-agent[type="application/json"].
  // k.fire(event) waits for a committed row; nav and local event types stay in this tab.
  function installPageState(pe, io) {
    let mounted = false;
    // Exception to no shims: these refuse in words; they never run a compatibility path.
    const retired = (name) => {
      const message = `This Page uses ${name}, which Pe removed on 2026-11-14. Its state is now one call, pe.state({ reduce, base, render, describe }). Ask Pea to update this Page.`;
      io.refuse?.(message);
      throw Error(message);
    };
    pe.kernel = () => retired("pe.kernel");
    pe.describe = () => retired("pe.describe");
    pe.state = async (options, ...legacy) => {
      if (legacy.length || typeof options?.fire === "function") retired("pe.state(k, {local})");
      const { reduce, base, render = () => {}, describe = () => "", local = [] } = options;
      if (mounted) throw Error("pe.state may be called only once per Page");
      mounted = true;
      const k = { state: base };
      let seq = 0;
      let queue = Promise.resolve();
      const publish = () => io.publish({ seq, text: String(describe(k.state)) });
      const apply = (row) => {
        if (row.seq <= seq) return;
        k.state = reduce(k.state, row.event, { origin: row.origin, seq: row.seq, at: row.at });
        seq = row.seq;
        render(k.state);
      };
      const saved = await io.load();
      if (saved.agentError) {
        if (io.refuse) io.refuse(saved.agentError);
        else console.error(saved.agentError);
      }
      for (const row of saved.events) apply(row);
      seq = saved.seq;
      render(k.state);
      await publish();
      io.follow((row) => {
        if (row.seq <= seq) return;
        apply(row);
        queue = queue
          .then(publish)
          .catch((error) => console.error("pe.state: text not kept", error));
      });
      k.fire = (event) => {
        if (event.type === "nav" || local.includes(event.type)) {
          const next = reduce(k.state, event, {
            origin: "page",
            seq,
            at: new Date().toISOString(),
          });
          if (next === k.state) return false;
          k.state = next;
          render(k.state);
          return true;
        }
        // Only committed rows render, so live and replay receive identical metadata.
        const job = queue.then(async () => {
          await io.append(event);
          // A reply can overtake SSE. Read the prefix before publishing its sequence.
          for (const row of (await io.load(seq)).events) apply(row);
          await publish();
          return true;
        });
        queue = job.catch((error) => console.error("pe.state: event not kept", error));
        return job;
      };
      return k;
    };
  }
  function offlinePage(exported) {
    const pe = {
      exported,
      page: exported.page,
      doc: exported.document,
      kitReady: Promise.resolve(null),
    };
    pe.target = async (...selector) => {
      if (selector.length) throw Error("An exported Page cannot select another document");
      if (!pe.doc) throw Error("This export has no document reading");
      return pe.doc;
    };
    installPageState(pe, {
      load: async () => ({ seq: exported.events.at(-1)?.seq ?? 0, events: exported.events }),
      publish: async () => {},
      follow: () => {},
      append: async () => { throw Error("An exported Page cannot append events"); },
    });
    return pe;
  }
  /*pe:offline-state:end*/

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
    /** The whole record of the last script run: `{ status, diagnostics, output, artifacts, data, … }`. */
    lastRun: null,
  };
  const pageInput = (body) => ({
    params: { slug: pe.slug },
    ...(body === undefined ? {} : { body }),
  });
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
      reading.resolution.message || `pe.target: this page's binding names no one document (${code}). Bind it from the chip.`,
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

  /** One act as this page (`/pages/<slug>/act`), waited until its receipt settles; answers the settled row. */
  const act = async (key, input) => {
    let row = await json(await client.response("page.act", pageInput({ key, input })));
    const id = row.id;
    while (row.state === "running") {
      await new Promise((ok) => setTimeout(ok, 250));
      [row = row] = await json(await client.response("actions.read", { query: { id } }));
    }
    return row;
  };

  /**
   * Run any op. A read answers at once on the bound document; a mutation runs as this page through
   * `/pages/<slug>/act`, under the binding (a document a human added to the bound thread, or Pea's own document for a pin), and this
   * waits until its receipt settles. The answer is the op's response either way. A script key
   * (`script:@snowdon-ducts/src/Census.cs`) is `pe.script(key, input)`: the same call, the same answer.
   */
  pe.do = async (key, input = {}) => {
    if (key.startsWith("script:")) return pe.script(key, input);
    const r = await client.response("page.call", pageInput({ key, request: input }));
    if (r.ok) return json(r);
    const wire = await r.json().catch(() => null);
    const answer = wire?.error?.details ?? wire;
    // Only "this is a mutation" moves on to act; a binding that names no one document stops here.
    if (!(r.status === 409 && answer && answer.notDispatched && !answer.resolution))
      return fail(r, answer ?? "");
    const row = await act(key, input);
    if (row.state !== "succeeded")
      throw new Error(`${key} ${row.state}: ${row.message || row.error || ""}`.trim());
    return row.result;
  };

  /**
   * The key a Pod Page's script path names. `checks/census.csx` is the file beside index.html and `/src/Census.cs`
   * is from the Pod root; both become `script:@<pod>/<path from the Pod root>`. Null on a scratch Page, which has
   * no Pod and so no script anyone can name by key.
   */
  const scriptKey = (path) => {
    const at = /^page:@([^/]+)\/(pages\/[^/]+)$/.exec(pe.page || "");
    if (!at || at[1] === "pages") return null;
    const member = decodeURIComponent(new URL(path, `http://pod/${at[2]}/`).pathname.slice(1));
    return `script:@${at[1]}/${member}`;
  };

  /**
   * Run C# in Revit, one door for every script. `keyOrPath` is a Pod's declared entrypoint, as its key
   * (`script:@snowdon-ducts/src/Census.cs`) or, on that Pod's own Page, as a `.cs`/`.csx` path (`checks/census.csx`
   * beside index.html, `/src/Census.cs` from the Pod root). The Pod declares it in pod.json `entrypoints`; a path it
   * does not declare is refused. A string with a newline is C# source and runs inline (Execute-body statements with
   * `doc`, `uidoc`, `app`, `selection` in scope), for a scratch Page or a probe; nobody else can run that by name.
   * `input` is one JSON object the script reads with `Arg<T>("name")`. `mode` is ReadOnly (every change rolls back),
   * WriteTransaction (one host-owned transaction) or NoTransaction (the script owns its transactions); a declared
   * entrypoint runs in the mode pod.json gives it, and inline source runs ReadOnly, unless you say otherwise.
   * Answers what the script gave `Result(...)`. Throws with the compiler's or the runtime's own words when the script
   * did not succeed; the whole run record (status, diagnostics, output, artifacts) is `error.run` and `pe.lastRun`.
   */
  pe.script = async (keyOrPath, { input, mode, permissionMode, timeoutSeconds = 120 } = {}) => {
    const inline = keyOrPath.includes("\n") || !/^script:@|\.csx?$/i.test(keyOrPath);
    let key = inline || keyOrPath.startsWith("script:@") ? keyOrPath : scriptKey(keyOrPath);
    let scriptContent = inline ? keyOrPath : undefined;
    if (key === null) {
      // A scratch Page's own file is its own source: it has no Pod to declare it in, so it runs as inline source.
      const r = await pe.fetch(new URL(keyOrPath, location.href), { cache: "no-store" });
      if (!r.ok) return fail(r);
      scriptContent = await r.text();
    }
    const run = { input, permissionMode: mode ?? permissionMode, timeoutSeconds };
    const row =
      scriptContent === undefined
        ? await act(key, run)
        : await act("scripting.execute", {
            ...run,
            scriptContent,
            permissionMode: run.permissionMode ?? "ReadOnly",
          });
    // A settled script answers its run record; a failed one keeps the same record as the receipt's evidence.
    const answered = row.result ?? row.evidence?.result;
    const record = answered && typeof answered === "object" ? answered : null;
    pe.lastRun = record;
    if (row.state === "succeeded" && record?.status === "Succeeded") return record.data ?? null;
    const why = (record?.diagnostics || [])
      .filter((d) => d.severity === "Error")
      .map((d) => d.message.split("\n")[0])
      .join("; ");
    const name = scriptContent === undefined ? key : "script";
    const error = new Error(
      `${name} ${record?.status ?? row.state}: ${why || row.message || row.error || ""}${record?.output ? `\n${record.output}` : ""}`.trim(),
    );
    error.run = record;
    throw error;
  };

  /**
   * A picture of elements the agent can cite: `revit.context.lens` boxes a 3D view around them (a mutation, through
   * `pe.do`), then `revit.context.view-image.focus` exports that view cropped to them (it commits a temporary crop and
   * its undo, so it too goes through `pe.do`; its `restore` says whether the undo held). The host keeps the PNG once
   * per sha at `url`; `marks` locates each element's bounds in image pixels, including in 3D. The default crop adds
   * twice the focus size on each side for context. `registration` places pixels in model XY when available.
   */
  pe.picture = async (elementIds, { name, paddingFeet, pixelSize, marginPercent = 200 } = {}) => {
    const lens = await pe.do("revit.context.lens", { elementIds, name, paddingFeet });
    const image = await pe.do("revit.context.view-image.focus", {
      target: { id: lens.viewId },
      focus: { elementIds },
      pixelSize,
      marginPercent,
    });
    const url = image.imageUrl;
    if (!url) throw new Error(`view-image of ${lens.viewName} was not kept by the host`);
    return {
      url,
      sha: (url.match(/([a-f0-9]{64})/i) || [])[1] || null,
      at: Date.now(),
      viewId: lens.viewId,
      viewName: lens.viewName,
      registration: image.registration || null,
      marks: image.marks,
    };
  };

  /** One reading: `rows` is whatever `run()` answers, `source` is the page's name for where it came from (an op key, a script path). */
  pe.reading = async (source, run) => {
    const rows = await run();
    return { source, at: Date.now(), rows };
  };

  /**
   * Run a script and answer what it changed, as rows a Page can draw. `run` is `{ script, input, mode,
   * timeoutSeconds, expect }` with `script` and the rest as `pe.script` takes them. Every run record already says
   * which elements it added, modified and deleted (`pe.lastRun.changes`); this reads their values around the run.
   * The script runs twice: first ReadOnly, where Revit rolls every document change back and the record names what it
   * would change, so those elements are read before; then for real, and the elements it did change are read after.
   * Only the document is rolled back: whatever the script does outside it (an artifact, a file it writes, a send
   * outward) happens on both runs. A script that cannot run ReadOnly (it owns its transactions, or edits a family)
   * is refused before it starts: `dry.ran` is false with the reason in `dry.why`, and the only elements read before
   * are the ids in `expect`, the ones the Page already knows the script is aimed at. Compared per element: its type,
   * and each of `parameterNames`, on Revit's raw value, shown as Revit displays it. Answers `{ data, changes, dry,
   * elements: [{ id, change, name, category }], rows: [{ id, change, parameter, before, after }], unchanged,
   * unread }`; `change` is added, modified or deleted, `unread` counts modified elements that were not read before
   * (they have no rows, because nothing says what changed on them), and `changes.summary` and `changes.undo` are the
   * run's own words. Throws as `pe.script` does when the real run fails.
   */
  pe.diff = async (run, parameterNames = []) => {
    if (Array.isArray(run) || typeof run !== "object" || run === null || typeof run.script !== "string")
      throw new Error(
        'pe.diff takes the run itself: pe.diff({ script: "heals/x.csx", input, expect: [ids] }, parameterNames). The (elementIds, parameterNames, run) form is retired; the changed ids now come from the run.',
      );
    const { script, input, mode, timeoutSeconds, expect = [] } = run;
    // ponytail: reads at most 500 elements a side; `truncated` says so. Page the read if a Page ever draws more.
    const cap = 500;
    const read = async (ids) => {
      const elements = new Map();
      if (!ids.length) return elements;
      const { entries } = await pe.read("revit.detail.elements", {
        query: {
          kind: "ElementReferences",
          elementIds: ids.slice(0, cap),
          parameterQuery: { parameters: parameterNames.map((name) => ({ name })) },
        },
      });
      for (const e of entries) {
        const values = new Map([["Type", { raw: e.typeName ?? null, shown: e.typeName ?? null }]]);
        for (const p of e.requestedParameters || [])
          values.set(p.name, { raw: p.rawValue ?? p.value ?? null, shown: p.displayValue ?? p.value ?? null });
        elements.set(e.elementId, { name: e.name, category: e.categoryName ?? null, values });
      }
      return elements;
    };
    const ids = (changes, ...kinds) => kinds.flatMap((kind) => changes?.[kind]?.ids || []);
    const dry = { ran: false, why: null, changes: null };
    try {
      await pe.script(script, { input, mode: "ReadOnly", timeoutSeconds });
      Object.assign(dry, { ran: true, changes: pe.lastRun?.changes ?? null });
    } catch (error) {
      if (!error.run) throw error;
      dry.why = error.message;
    }
    const before = await read([...new Set([...ids(dry.changes, "modified", "deleted"), ...expect])]);
    const data = await pe.script(script, { input, mode, timeoutSeconds });
    const changes = pe.lastRun?.changes ?? null;
    const after = await read(ids(changes, "added", "modified"));
    const elements = [];
    const rows = [];
    let unchanged = 0;
    let unread = 0;
    for (const change of ["added", "modified", "deleted"])
      for (const id of ids(changes, change)) {
        const [b, a] = [before.get(id), after.get(id)];
        elements.push({ id, change, name: (a ?? b)?.name ?? null, category: (a ?? b)?.category ?? null });
        if (change === "modified" && !b) {
          unread++;
          continue;
        }
        for (const parameter of new Set([...(b?.values.keys() || []), ...(a?.values.keys() || [])])) {
          const [from, to] = [b?.values.get(parameter), a?.values.get(parameter)];
          if (from && to && from.raw === to.raw) unchanged++;
          else rows.push({ id, change, parameter, before: from?.shown ?? null, after: to?.shown ?? null });
        }
      }
    const total = (c) => (c ? c.added.total + c.modified.total + c.deleted.total : 0);
    return { data, changes, dry, elements, rows, unchanged, unread, truncated: total(changes) > elements.length || elements.length > cap };
  };

  let streamSeq = 0;
  let rowListener = null;
  const pendingRows = [];
  let stopped = false;
  let retryMs = 1000;
  let heard = Date.now();
  let retry;
  let watchdog;
  const follow = () => {
    if (stopped) return;
    const es = new EventSource(
      streamUrl(client.url("page.events", { ...pageInput(), query: { after: streamSeq } })),
    );
    pe.events = es;
    heard = Date.now();
    es.onopen = () => {
      retryMs = 1000;
      heard = Date.now();
    };
    es.onmessage = (message) => {
      heard = Date.now();
      const row = JSON.parse(message.data);
      streamSeq = Math.max(streamSeq, row.seq);
      if (rowListener) rowListener(row);
      else pendingRows.push(row);
    };
    es.addEventListener("ping", () => {
      heard = Date.now();
    });
    es.addEventListener("file", (message) => {
      heard = Date.now();
      if (/\.(html|m?js|css)$/i.test(JSON.parse(message.data).path)) location.reload();
    });
    let replaced = false;
    const replace = () => {
      if (replaced) return;
      replaced = true;
      es.close();
      clearInterval(watchdog);
      if (stopped) return;
      retry = setTimeout(follow, retryMs);
      retryMs = Math.min(retryMs * 2, 10000);
    };
    es.onerror = replace;
    watchdog = setInterval(() => {
      if (Date.now() - heard > (es.readyState === 1 ? 45000 : 10000)) replace();
    }, 2000);
  };
  installPageState(pe, {
    refuse: banner,
    load: (after = 0) =>
      client.response("page.state", { ...pageInput(), query: { after } }).then(json),
    append: (event) => client.response("page.append", pageInput(event)).then(json),
    publish: async (projection) => {
      const r = await client.response("page.text", pageInput(projection));
      if (r.status === 409) return; // Another tab published a newer prefix; its text wins.
      if (!r.ok) return fail(r);
    },
    follow: (listen) => {
      rowListener = listen;
      for (const row of pendingRows.splice(0)) listen(row);
    },
  });
  if (pe.slug && typeof EventSource === "function") follow();
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      pe.events?.close();
    },
    { once: true },
  );

  window.pe = pe;
  /** One host-served presentation bundle; pages await this before mounting their instruments. */
  pe.kitReady = new Promise((resolve, reject) => {
    if (!document.head || !document.createElement) return resolve(null);
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "/pages/kit/pe-kit.css";
    const script = document.createElement("script");
    script.src = "/pages/kit/pe-kit.js";
    let styled = false;
    let loaded = false;
    const ready = () => {
      if (!styled || !loaded) return;
      if (pe.kit) resolve(pe.kit);
      else reject(new Error("Page kit did not expose pe.kit"));
    };
    style.onload = () => {
      styled = true;
      ready();
    };
    style.onerror = () => reject(new Error("Page kit styles could not load from this host"));
    script.onload = () => {
      loaded = true;
      ready();
    };
    script.onerror = () => reject(new Error("Page kit could not load from this host"));
    document.head.append(style, script);
  });
})();
