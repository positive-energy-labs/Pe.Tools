"""Stage t3: T3 database (read-only) -> t3_threads.json, t3_events.jsonl, t3_provider_threads.json.

threads (lineage, branch, model selection), runs (per-run model + effort), messages -> events. Event kinds:
  owner_turn       landed.owner_turn: createdBy=user AND creationSource web|mobile (a human at a surface)
  relay            createdBy=user, creationSource=server: agent text a child sent up through the user role, NOT the owner
  agent_msg (senderThreadId)  child_completion  automation  notification  other_user_msg
  final_reply      last assistant message of each run (by created_at); model/effort come from that run
  handoff, transfer (subagent_spawn, subagent_result, fork, provider_handoff)
"""
import collections, json
from common import *


def user_kind(d):
    """Classify one user-role message payload. Order matters: sender/delegation markers beat the createdBy test."""
    if d.get("senderThreadId"): return "agent_msg"
    if d.get("delegatedCompletion"): return "child_completion"
    if d.get("scheduledTaskId"): return "automation"
    if d.get("notification"): return "notification"
    by, src = d.get("createdBy"), d.get("creationSource")
    if landed.owner_turn(by, src): return "owner_turn"
    if by == "user" and src == "server": return "relay"
    return "other_user_msg"


def effort(ms):
    for o in (ms or {}).get("options") or []:
        if "effort" in o.get("id", "") or "reasoning" in o.get("id", ""): return o.get("value")
    return None


def trunc(t, n=4000):
    t = t or ""
    return t[:n], len(t) > n


def run(R):
    LO, HI = R.lo, R.hi
    c = db()
    T, RN, M, PT = ("orchestration_v2_projection_" + x for x in ("threads", "runs", "messages", "provider_threads"))
    threads = {}
    for tid, title, created, pj in c.execute(f"select thread_id,title,created_at,payload_json from {T} where project_id=?", (R.project,)):
        d = json.loads(pj); lin = d.get("lineage") or {}
        threads[tid] = dict(id=tid, title=title, created_at=norm(created), parent=lin.get("parentThreadId"), root=lin.get("rootThreadId") or tid,
                            relationship=lin.get("relationshipToParent"), branch=d.get("branch"), worktree=d.get("worktreePath"),
                            model_selection=d.get("modelSelection"), created_by=d.get("createdBy"), creation_source=d.get("creationSource"),
                            archived_at=d.get("archivedAt"), deleted_at=d.get("deletedAt"), history_origin=d.get("historyOrigin"))
    runs = {}
    for rid, tid, ordn, status, req, comp, pj in c.execute(f"select run_id,thread_id,ordinal,status,requested_at,completed_at,payload_json from {RN}"):
        if tid not in threads or not R.inwin(norm(req)): continue
        d = json.loads(pj); ms = d.get("modelSelection") or {}
        runs[rid] = dict(run_id=rid, thread=tid, ordinal=ordn, status=status, requested=norm(req), completed=norm(comp) if comp else None,
                         provider=ms.get("instanceId"), model=ms.get("model"), effort=effort(ms), user_message_id=d.get("userMessageId"),
                         delegated_task=d.get("delegatedTaskId"), handoff=d.get("contextHandoffId"))
    msg_user = {r["user_message_id"]: r["run_id"] for r in runs.values() if r["user_message_id"]}
    events, last_assist, active = [], {}, set(r["thread"] for r in runs.values())
    for mid, tid, rid, role, created, pj in c.execute(f"select message_id,thread_id,run_id,role,created_at,payload_json from {M}"):
        if tid not in threads: continue
        cr = norm(created)
        if not R.inwin(cr): continue
        active.add(tid)
        d = json.loads(pj); text = d.get("text") or ""
        if role == "assistant":
            if rid and (rid not in last_assist or cr >= last_assist[rid][0]): last_assist[rid] = (cr, mid, text, tid)
            continue
        if role != "user": continue
        base = dict(ts=cr, thread=tid, run=rid or msg_user.get(mid), msg=mid)
        kind = user_kind(d); src = d.get("creationSource")
        if kind == "owner_turn":
            events.append(dict(base, kind=kind, source=src, chars=len(text), text=text, attachments=len(d.get("attachments") or [])))
        elif kind == "agent_msg":
            t, tr = trunc(text, 6000); events.append(dict(base, kind=kind, sender=d["senderThreadId"], target=tid, chars=len(text), text=t, truncated=tr, source=src))
        elif kind == "child_completion":
            t, tr = trunc(text); events.append(dict(base, kind=kind, chars=len(text), text=t, truncated=tr, delegated=d["delegatedCompletion"]))
        elif kind == "automation":
            t, tr = trunc(text); events.append(dict(base, kind=kind, scheduled_task=d["scheduledTaskId"], chars=len(text), text=t, truncated=tr, source=src))
        elif kind == "notification":
            t, tr = trunc(text, 800); n = d["notification"]
            events.append(dict(base, kind=kind, chars=len(text), text=t, truncated=tr, outcome=n.get("outcome"), summary=n.get("summary"), src_kind=(n.get("source") or {}).get("kind")))
        else:  # relay | other_user_msg
            t, tr = trunc(text); events.append(dict(base, kind=kind, created_by=d.get("createdBy"), source=src, chars=len(text), text=t, truncated=tr))
    for rid, (cr, mid, text, tid) in last_assist.items():
        r = runs.get(rid)
        events.append(dict(ts=cr, thread=tid, run=rid, msg=mid, kind="final_reply", model=r and r["model"], effort=r and r["effort"],
                           provider=r and r["provider"], chars=len(text), text=text))
    for hid, tid, trid, strat, status, upd, pj in c.execute("select context_handoff_id,thread_id,target_run_id,strategy,status,updated_at,payload_json from orchestration_v2_projection_context_handoffs"):
        if tid not in threads or not R.inwin(norm(upd)): continue
        d = json.loads(pj); active.add(tid); s = d.get("summaryText") or ""
        events.append(dict(ts=norm(upd), kind="handoff", thread=tid, run=trid, strategy=strat, status=status, from_provider_threads=len(d.get("fromProviderThreadIds") or []),
                           covered=d.get("coveredRunOrdinals"), summary_chars=len(s), summary_head=s[:600], transfer=d.get("transferId")))
    tcount = collections.Counter()
    for xid, src, tgt, trid, typ, status, sp, tp, upd in c.execute("select context_transfer_id,source_thread_id,target_thread_id,target_run_id,type,status,source_provider,target_provider,updated_at from orchestration_v2_projection_context_transfers"):
        if not R.inwin(norm(upd)) or (src not in threads and tgt not in threads): continue
        tcount[typ] += 1
        events.append(dict(ts=norm(upd), kind="transfer", type=typ, source=src, target=tgt, run=trid, status=status, source_provider=sp, target_provider=tp))
    anc = set()
    for tid in list(active):
        x = tid
        while x in threads and x not in anc: anc.add(x); x = threads[x]["parent"]
    keep = active | anc
    events.sort(key=lambda e: (e["ts"], e["kind"]))
    dump(R.p("t3_threads.json"), dict(window=[LO, HI], project=R.project, threads={k: threads[k] for k in keep}, runs=list(runs.values()), active=sorted(active)))
    with open(R.p("t3_events.jsonl"), "w", encoding="utf-8") as f:
        for e in events: f.write(json.dumps(e, ensure_ascii=False) + "\n")
    refs = []
    for pid, tid, pj in c.execute(f"select provider_thread_id,thread_id,payload_json from {PT}"):
        if tid in keep:
            d = json.loads(pj); r = d.get("nativeThreadRef") or {}
            refs.append(dict(thread=tid, driver=r.get("driver") or d.get("driver"), native=r.get("nativeId"), created_at=d.get("createdAt")))
    dump(R.p("t3_provider_threads.json"), refs)
    kinds = dict(collections.Counter(e["kind"] for e in events))
    print("t3: threads kept", len(keep), "active", len(active), "runs", len(runs), "events", len(events), kinds, dict(tcount), "refs", len(refs))
