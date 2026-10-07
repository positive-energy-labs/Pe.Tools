/* pe.js — a page's doors into Revit. One script tag, one global:
 *
 *   <script src="/pages/pe.js"></script>
 *   await pe.target();                                   // which Revit session and document the page talks to
 *   await pe.find("show elements");                      // rank the catalog by words → [{ key, intent, description }]
 *   await pe.read("revit.context.summary");              // run a read; the answer is the op's response
 *   await pe.do("revit.context.show-elements", { elementIds: [1234] });   // run a mutation; waits until it settles
 *   await pe.script("checks/census.csx");                // run C# in Revit: a source string, or a .cs/.csx path beside the page
 *   await pe.state(kernel);                              // share a kit kernel's event log with every copy and every agent
 *   pe.describe(() => `# ${kernel.state.title}`);        // what the page says, as markdown, kept beside the snapshot for agents
 *   await pe.picture([1234]);                            // lens then view-image: { url, sha, at, viewId, viewName, registration }
 *   await pe.reading("checks/census.csx", run);          // one reading: { source, at, rows } with rows = what `run()` answered
 *   await pe.diff([1234], ["Mark"], run);                // read the parameters, run, read again: the rows that changed
 *
 * `find`, `read` and `do` are the same words and keys as Pea's `pe_find`, `pe_read` and `pe_do`, over the same
 * endpoints an agent uses by hand (`/ops`, `/call`, `/actions`). The script only adds what every page gets wrong
 * first time: the target headers, the read-versus-write door, and the shared log.
 */
(() => {
  const H = {
    session: "x-pe-bridge-session-id",
    doc: "x-pe-open-document-id",
    origin: "x-pe-origin",
    actor: "x-pe-action-actor",
  };
  const pe = {
    /** The page's slug, from its URL. */
    slug: (location.pathname.match(/^\/pages\/([^/]+)/) || [])[1] || "",
    /** The chosen document `{ session, openId, title }`, after `pe.target()`. */
    doc: null,
  };
  const headers = () => ({
    "content-type": "application/json",
    [H.origin]: `page:${pe.slug}`,
    ...(pe.doc ? { [H.session]: pe.doc.session, [H.doc]: pe.doc.openId } : {}),
  });
  // The host's own refusal, word for word, is the error message.
  const fail = async (r, body) => {
    const b = body === undefined ? await r.text().catch(() => "") : body;
    let m = typeof b === "string" ? b : "";
    try {
      const j = typeof b === "string" ? JSON.parse(b) : b;
      m = j.message || j.error || j.title || m;
    } catch {}
    throw new Error(`${r.status} ${r.statusText}${m ? `: ${m}` : ""}`);
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
  const post = (path, body) =>
    fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });

  /**
   * Choose the Revit session and document. `?session=<id>&doc=<openId>` or `?title=<part of the title>` on the
   * page URL pins one; otherwise the only connected session and its active document. Sets `pe.doc`.
   */
  pe.target = async (want = Object.fromEntries(new URLSearchParams(location.search))) => {
    const { sessions } = await json(
      await post("/call", { key: "bridge.sessions.list", request: {} }),
    );
    const s =
      sessions.find((x) => x.sessionId === want.session) ||
      (sessions.length === 1
        ? sessions[0]
        : sessions.find((x) => (x.openDocuments || []).some((d) => d.isActive)));
    if (!s)
      throw new Error(
        sessions.length
          ? `${sessions.length} Revit sessions are connected; add ?session=<id> to the page URL (${sessions.map((x) => x.sessionId).join(", ")})`
          : "no Revit session is connected to the host (pe-revit session start, or open Revit with Pe.Tools installed)",
      );
    const docs = s.openDocuments || [];
    const d =
      docs.find((x) => x.openId === want.doc) ||
      (want.title && docs.find((x) => x.title.toLowerCase().includes(want.title.toLowerCase()))) ||
      docs.find((x) => x.isActive) ||
      docs[0];
    if (!d) throw new Error(`Revit session ${s.sessionId} has no open document`);
    pe.doc = { session: s.sessionId, openId: d.openId, title: d.title };
    return pe.doc;
  };

  /** Rank the catalog by words, like `pe_find`. No words lists everything. */
  pe.find = async (words = "") => {
    const q = pe.doc ? `?session=${encodeURIComponent(pe.doc.session)}` : "";
    const { operations } = await json(
      await fetch(`/ops${q}`, { headers: { accept: "application/json" } }),
    );
    const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
    return operations
      .map((op) => {
        const text = `${op.key} ${op.displayName || ""} ${op.description || ""}`.toLowerCase();
        return {
          key: op.key,
          intent: op.intent,
          description: op.description || "",
          score: terms.filter((t) => text.includes(t)).length,
        };
      })
      .filter((op) => !terms.length || op.score)
      .sort((a, b) => b.score - a.score)
      .map(({ score: _score, ...op }) => op);
  };

  /** Run a read through `/call`. A mutation is refused here by the host; use `pe.do`. */
  pe.read = async (key, request = {}) => {
    if (!pe.doc) await pe.target();
    return json(await post("/call", { key, request }));
  };

  /**
   * Run any op. A read answers at once through `/call`; a mutation is admitted through `/actions` as a human act
   * and this waits until its receipt settles. The answer is the op's response either way.
   */
  pe.do = async (key, input = {}) => {
    if (!pe.doc) await pe.target();
    const r = await post("/call", { key, request: input });
    if (r.ok) return json(r);
    const refusal = await r.json().catch(() => null);
    if (!(r.status === 409 && refusal && refusal.notDispatched)) return fail(r, refusal ?? "");
    const id = crypto.randomUUID();
    let row = await json(
      await post("/actions", {
        id,
        kind: "operation",
        key,
        actor: "human",
        destination: { kind: "document", ref: { session: pe.doc.session, openId: pe.doc.openId } },
        input,
      }),
    );
    while (row.state === "running") {
      await new Promise((ok) => setTimeout(ok, 250));
      [row = row] = await json(
        await fetch(`/actions?id=${encodeURIComponent(id)}`, { headers: headers() }),
      );
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
      const r = await fetch(new URL(source, location.href), { cache: "no-store" });
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
    const base = `/pages/${pe.slug}`;
    const mine = new Set();
    let seq = 0;
    let timer;
    const snapshot = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fetch(`${base}/snapshot`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify(k.state),
        }).catch(() => {});
        if (describe)
          fetch(`${base}/text`, {
            method: "PUT",
            headers: { ...headers(), "content-type": "text/markdown" },
            body: String(describe(k.state)),
          }).catch(() => {});
      }, 150);
    };
    const saved = await json(await fetch(`${base}/state`));
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
      post(`${base}/events`, ev)
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
      const es = new EventSource(`${base}/events?after=${seq}`);
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

  // A tab never learns its page file changed, so a stale copy keeps running old code: kaitpw pressed pre-fix
  // buttons for two hours while the fix was on disk (2026-10-05). Re-read the page's own file and reload on change.
  // ponytail: polls the whole file every 15 s; a host-sent mtime on the events heartbeat replaces it if pages get big.
  if (pe.slug) {
    const own = () => fetch(location.pathname, { cache: "no-store" }).then((r) => (r.ok ? r.text() : null));
    own().then((first) =>
      setInterval(
        () => own().then((now) => now != null && first != null && now !== first && location.reload(), () => {}),
        15000,
      ),
    );
  }

  window.pe = pe;
})();
