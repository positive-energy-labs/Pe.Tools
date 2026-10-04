/* pe.js — a page's doors into Revit. One script tag, one global:
 *
 *   <script src="/pages/pe.js"></script>
 *   await pe.target();                                   // which Revit session and document the page talks to
 *   await pe.find("show elements");                      // rank the catalog by words → [{ key, intent, description }]
 *   await pe.read("revit.context.summary");              // run a read; the answer is the op's response
 *   await pe.do("revit.context.show-elements", { elementIds: [1234] });   // run a mutation; waits until it settles
 *   await pe.state(kernel);                              // share a kit kernel's event log with every copy and every agent
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
  const json = async (r) => (r.ok ? r.json() : fail(r));
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
    if (r.ok) return r.json();
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
   * Share a kit kernel's event log through the host. Replays the saved log into `k`, sends every later `k.fire`
   * to `/pages/<slug>/events`, follows other copies and agents live, and keeps `/pages/<slug>/state`'s snapshot
   * current. Hash navigation (`nav`) stays local. Resolves to `k` once the replay is in.
   */
  pe.state = async (k) => {
    const base = `/pages/${pe.slug}`;
    const mine = new Set();
    let seq = 0;
    let timer;
    const snapshot = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          fetch(`${base}/snapshot`, {
            method: "PUT",
            headers: headers(),
            body: JSON.stringify(k.state),
          }).catch(() => {}),
        150,
      );
    };
    const saved = await json(await fetch(`${base}/state`));
    seq = saved.seq;
    k.replay(saved.events.map((row) => row.event));
    const fire = k.fire;
    k.fire = (ev) => {
      if (ev.type === "nav") return fire(ev);
      ev.id ||= crypto.randomUUID();
      if (!fire(ev)) return false;
      mine.add(ev.id);
      snapshot();
      post(`${base}/events`, ev)
        .then(json)
        .then((row) => (seq = Math.max(seq, row.seq)))
        .catch((e) => console.error("pe.state: the host did not keep an event", e));
      return true;
    };
    const es = new EventSource(`${base}/events?after=${seq}`);
    es.onmessage = (m) => {
      const row = JSON.parse(m.data);
      seq = Math.max(seq, row.seq);
      if (mine.delete(row.event.id)) return; // our own fire, already applied
      if (fire(row.event)) snapshot();
    };
    // ponytail: undo stays local to one copy; a shared undo is an event of its own when a page needs it.
    pe.events = es;
    return k;
  };

  window.pe = pe;
})();
