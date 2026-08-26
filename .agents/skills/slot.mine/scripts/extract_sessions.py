#!/usr/bin/env python3
"""Stream retained Claude/Codex authored turns without printing transcript text."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


CLIENTS = {
    "codex-tui": "TUI",
    "codex_cli_rs": "TUI",
    "Codex Desktop": "Desktop",
    "t3code_desktop": "T3 Code",
}
BLOCK_TAGS = (
    "INSTRUCTIONS",
    "environment_context",
    "permissions instructions",
    "collaboration_mode",
    "apps_instructions",
    "plugins_instructions",
    "skills_instructions",
    "system-reminder",
    "subagent_notification",
    "tool_result",
)
NOISE_PREFIXES = (
    "<task-notification",
    "<local-command",
    "[system notification",
    "[request interrupted",
    "message type: message",
    "message type: final_answer",
    "api error",
)
CONTINUATION = re.compile(
    r"^\s*(?:this session is being continued from a previous conversation|"
    r"your task is to create a detailed summary of the conversation|"
    r"please continue the conversation from where we left|"
    r"continue from (?:the )?(?:context |conversation )?summary|"
    r"you have \d[\d,]* weighted tokens left)",
    re.I,
)
UNCERTAIN_AUTHORSHIP = re.compile(
    r"^\s*(?:#\s*(?:mission|task)\b|your task is to\b|you are in (?:the )?(?:git )?worktree\b|strict read boundary\b)",
    re.I,
)


def epoch(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) / 1000 if value > 10_000_000_000 else float(value)
    try:
        numeric = float(value)
        return numeric / 1000 if numeric > 10_000_000_000 else numeric
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None


def stamp(value: float | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


def normalized(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip().casefold()


def digest(text: str) -> str:
    return hashlib.sha256(normalized(text).encode("utf-8")).hexdigest()


def file_signature(path: Path) -> dict:
    try:
        stat = path.stat()
        return {"size": stat.st_size, "mtimeNs": stat.st_mtime_ns}
    except OSError:
        return {"missing": True}


def input_drift(before: dict, after: dict) -> list[str]:
    return sorted(key for key in before.keys() | after.keys() if before.get(key) != after.get(key))


def clean(text: str) -> str:
    value = text or ""
    value = re.sub(r"<command-name>\s*(.*?)\s*</command-name>", r" \1 ", value, flags=re.I | re.S)
    value = re.sub(r"<command-args>\s*(.*?)\s*</command-args>", r" \1 ", value, flags=re.I | re.S)
    value = re.sub(r"<command-(?:message|contents)>.*?</command-(?:message|contents)>", " ", value, flags=re.I | re.S)
    for tag in BLOCK_TAGS:
        value = re.sub(rf"<{re.escape(tag)}(?:\s[^>]*)?>.*?</{re.escape(tag)}>", " ", value, flags=re.I | re.S)
    value = re.sub(r"#\s*AGENTS\.md instructions for[^\n]*", " ", value, flags=re.I)
    value = re.sub(r"[\t\r\f\v ]+", " ", value)
    value = re.sub(r"\n\s*\n+", "\n", value).strip()
    return value


def text_parts(content) -> list[str]:
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    return [
        item.get("text", "")
        for item in content
        if isinstance(item, dict) and item.get("type") in {"text", "input_text"}
    ]


class Miner:
    def __init__(self, args):
        self.home = Path.home()
        self.since = epoch(args.since) if args.since else None
        self.until = epoch(args.until) + 86_400 if args.until else None
        self.excluded = set(args.exclude_session)
        self.rows: list[dict] = []
        self.projections: list[dict] = []
        self.excluded_authored: list[tuple[str, str, float | None]] = []
        self.drops = Counter()
        self.errors = Counter()
        self.stores = defaultdict(lambda: Counter(files=0, bytes=0, scanned=0, retained=0))
        self.sessions: dict[tuple[str, str], dict] = {}

    def path(self, value: Path) -> str:
        try:
            return "~/" + value.resolve().relative_to(self.home.resolve()).as_posix()
        except ValueError:
            return str(value)

    def input_paths(self) -> list[Path]:
        roots = (self.home / ".codex" / "sessions", self.home / ".codex" / "archived_sessions")
        paths = {path for root in roots if root.exists() for path in root.rglob("*.jsonl")}
        claude = self.home / ".claude" / "projects"
        if claude.exists():
            paths.update(claude.glob("*/*.jsonl"))
        paths.update(
            path for path in (
                self.home / ".codex" / "history.jsonl",
                self.home / ".codex" / "thread_history_1.sqlite",
                self.home / ".t3" / "userdata" / "state.sqlite",
            ) if path.exists()
        )
        return sorted(paths)

    def record_session(self, store: str, session, **facts):
        if not session:
            return
        key = (store, str(session))
        row = self.sessions.setdefault(key, {"store": store, "session": str(session)})
        row.update({name: value for name, value in facts.items() if value is not None})

    def add(self, *, provider: str, client: str, session, timestamp, path: Path,
            locator: str, representation: str, text: str, canonical: bool,
            authored_id=None):
        session = str(session or "")
        when = epoch(timestamp)
        if self.since is not None and (when is None or when < self.since):
            self.drops["before window"] += 1
            return None
        if self.until is not None and (when is None or when >= self.until):
            self.drops["after window"] += 1
            return None
        value = clean(text)
        if not value:
            self.drops["empty after cleaning"] += 1
            return None
        value_hash = digest(value)
        if session in self.excluded or any(item and item in str(path) for item in self.excluded):
            self.excluded_authored.append((provider, value_hash, when))
            self.drops["excluded session"] += 1
            return None
        if not canonical and any(
            prior_provider == provider
            and prior_hash == value_hash
            and prior_when is not None
            and when is not None
            and abs(prior_when - when) <= 600
            for prior_provider, prior_hash, prior_when in self.excluded_authored
        ):
            self.drops["projection of excluded session"] += 1
            return None
        if value.casefold().startswith(NOISE_PREFIXES) or CONTINUATION.match(value):
            self.drops["harness or continuation"] += 1
            return None
        store = "Codex rollout" if representation in {"event_msg.user_message", "response_item.role=user"} else representation
        uncertain = bool(UNCERTAIN_AUTHORSHIP.match(value))
        row = {
            "provider": provider,
            "client": client,
            "store": store,
            "session": session or None,
            "timestamp": stamp(when),
            "epoch": when,
            "path": self.path(path),
            "locator": locator,
            "representation": representation,
            "canonical": canonical,
            "projection_only": not canonical,
            "authored_id": str(authored_id) if authored_id else None,
            "authorship": "uncertain" if uncertain else "human",
            "authorship_reason": "dispatch-shaped user row" if uncertain else None,
            "hash": value_hash,
            "text": value,
            "copies": [],
        }
        (self.rows if canonical else self.projections).append(row)
        self.stores[store]["retained"] += 1
        return row

    def scan_codex(self):
        roots = (self.home / ".codex" / "sessions", self.home / ".codex" / "archived_sessions")
        paths = sorted({path for root in roots if root.exists() for path in root.rglob("*.jsonl")})
        for path in paths:
            store = "Codex rollout"
            self.stores[store]["files"] += 1
            self.stores[store]["bytes"] += path.stat().st_size
            meta, candidates = {}, []
            try:
                with path.open("r", encoding="utf-8", errors="replace") as stream:
                    for number, line in enumerate(stream, 1):
                        self.stores[store]["scanned"] += 1
                        try:
                            item = json.loads(line)
                        except json.JSONDecodeError:
                            self.errors["Codex bad JSON"] += 1
                            continue
                        if item.get("type") == "session_meta" and not meta:
                            meta = item.get("payload") or {}
                            continue
                        payload = item.get("payload") or {}
                        representation, value = None, ""
                        if item.get("type") == "event_msg" and payload.get("type") == "user_message":
                            representation = "event_msg.user_message"
                            value = str(payload.get("message") or "")
                        elif item.get("type") == "response_item" and payload.get("role") == "user":
                            representation = "response_item.role=user"
                            value = "\n".join(text_parts(payload.get("content"))) or str(payload.get("text") or "")
                        if representation is None:
                            continue
                        if isinstance(meta.get("source"), dict) or meta.get("thread_source") == "subagent":
                            self.drops["Codex subagent"] += 1
                            continue
                        client = CLIENTS.get(str(meta.get("originator")))
                        if not client:
                            self.drops["Codex non-target origin"] += 1
                            continue
                        before = len(self.rows)
                        row = self.add(
                            provider="codex", client=client,
                            session=meta.get("id") or meta.get("session_id"),
                            timestamp=item.get("timestamp"), path=path, locator=f"line {number}",
                            representation=representation, text=value, canonical=True,
                            authored_id=payload.get("id"),
                        )
                        if row:
                            candidates.append((number, row))
                            self.rows.pop()
                        assert len(self.rows) == before
            except OSError:
                self.errors["Codex unreadable file"] += 1
                continue
            client = CLIENTS.get(str(meta.get("originator")))
            self.record_session(
                store,
                meta.get("id") or meta.get("session_id"),
                provider="codex",
                client=client,
                path=self.path(path),
                cwd=meta.get("cwd"),
                originator=meta.get("originator"),
            )
            events = [(number, row) for number, row in candidates if row["representation"] == "event_msg.user_message"]
            for number, row in candidates:
                duplicate = row["representation"] == "response_item.role=user" and any(
                    event["hash"] == row["hash"] and abs(event_number - number) <= 5
                    for event_number, event in events
                )
                if duplicate:
                    self.drops["Codex duplicate representation"] += 1
                else:
                    self.rows.append(row)

    def scan_claude(self):
        root = self.home / ".claude" / "projects"
        for path in sorted(root.glob("*/*.jsonl")) if root.exists() else []:
            store = "Claude CLI"
            self.stores[store]["files"] += 1
            self.stores[store]["bytes"] += path.stat().st_size
            try:
                with path.open("r", encoding="utf-8", errors="replace") as stream:
                    for number, line in enumerate(stream, 1):
                        self.stores[store]["scanned"] += 1
                        try:
                            item = json.loads(line)
                        except json.JSONDecodeError:
                            self.errors["Claude bad JSON"] += 1
                            continue
                        if item.get("type") == "queue-operation" and item.get("operation") == "enqueue":
                            value = str(item.get("content") or "")
                        elif item.get("type") == "user":
                            if item.get("isMeta") or item.get("isSidechain"):
                                self.drops["Claude meta or sidechain"] += 1
                                continue
                            if item.get("sourceToolUseID") or item.get("sourceToolAssistantUUID") or item.get("toolUseResult") is not None:
                                self.drops["Claude tool-sourced user row"] += 1
                                continue
                            value = "\n".join(text_parts((item.get("message") or {}).get("content")))
                        else:
                            continue
                        self.add(
                            provider="claude", client="Claude CLI",
                            session=item.get("sessionId") or path.stem,
                            timestamp=item.get("timestamp"), path=path, locator=f"line {number}",
                            representation=store, text=value, canonical=True,
                            authored_id=item.get("uuid"),
                        )
                        self.record_session(
                            store,
                            item.get("sessionId") or path.stem,
                            provider="claude",
                            client="Claude CLI",
                            path=self.path(path),
                            cwd=item.get("cwd"),
                            model=item.get("model"),
                        )
            except OSError:
                self.errors["Claude unreadable file"] += 1

    def scan_projections(self):
        self.scan_tui_history()
        self.scan_desktop_history()
        self.scan_t3_history()

    def scan_tui_history(self):
        path = self.home / ".codex" / "history.jsonl"
        if not path.exists():
            return
        store = "Codex TUI projection"
        self.stores[store].update(files=1, bytes=path.stat().st_size)
        with path.open("r", encoding="utf-8", errors="replace") as stream:
            for number, line in enumerate(stream, 1):
                self.stores[store]["scanned"] += 1
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    self.errors["TUI bad JSON"] += 1
                    continue
                self.add(provider="codex", client="TUI", session=item.get("session_id"),
                         timestamp=item.get("ts"), path=path, locator=f"line {number}",
                         representation=store, text=str(item.get("text") or ""), canonical=False)
                self.record_session(store, item.get("session_id"), provider="codex", client="TUI", path=self.path(path))

    def scan_desktop_history(self):
        path = self.home / ".codex" / "thread_history_1.sqlite"
        if not path.exists():
            return
        store = "Codex Desktop projection"
        self.stores[store].update(files=1, bytes=path.stat().st_size)
        try:
            with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as db:
                query = "select thread_id,item_id,created_at_ms,item_json from thread_items where item_type='userMessage' order by created_at_ms,rollout_ordinal"
                for number, (thread, item_id, created, raw) in enumerate(db.execute(query), 1):
                    self.stores[store]["scanned"] += 1
                    try:
                        item = json.loads(raw)
                        value = "\n".join(text_parts(item.get("content"))) or str(item.get("text") or "")
                    except (json.JSONDecodeError, AttributeError):
                        self.errors["Desktop bad item JSON"] += 1
                        continue
                    self.add(provider="codex", client="Desktop", session=thread, timestamp=created,
                             path=path, locator=f"item {number} ({item_id})", representation=store,
                             text=value, canonical=False)
                    self.record_session(store, thread, provider="codex", client="Desktop", path=self.path(path))
        except sqlite3.Error:
            self.errors["Desktop SQLite"] += 1

    def scan_t3_history(self):
        path = self.home / ".t3" / "userdata" / "state.sqlite"
        if not path.exists():
            return
        store = "T3 projection"
        self.stores[store].update(files=1, bytes=path.stat().st_size)
        try:
            with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True) as db:
                session_query = """
                    select t.thread_id,t.title,t.created_at,t.updated_at,t.model_selection_json,
                           s.provider_name,s.provider_session_id,s.provider_thread_id
                    from projection_threads t
                    join projection_thread_sessions s on s.thread_id=t.thread_id
                    where lower(s.provider_name) in ('codex','claudeagent')
                """
                for thread, title, created, updated, model_json, provider_name, provider_session, provider_thread in db.execute(session_query):
                    provider = "claude" if str(provider_name).lower() == "claudeagent" else "codex"
                    try:
                        model = (json.loads(model_json) if model_json else {}).get("model")
                    except (json.JSONDecodeError, AttributeError):
                        model = None
                    self.record_session(
                        store,
                        thread,
                        provider=provider,
                        client="T3 Code",
                        path=self.path(path),
                        title=title,
                        model=model,
                        created_at=created,
                        updated_at=updated,
                        provider_session_id=provider_session,
                        provider_thread_id=provider_thread,
                        canonical_session=provider_session or provider_thread,
                        join_method="provider id" if provider_session or provider_thread else "unresolved",
                        join_confidence="hard" if provider_session or provider_thread else "none",
                    )
                query = """
                    select m.message_id,m.thread_id,m.turn_id,m.text,m.created_at,s.provider_name
                    from projection_thread_messages m
                    join projection_thread_sessions s on s.thread_id=m.thread_id
                    where m.role='user' and lower(s.provider_name) in ('codex','claudeagent')
                    order by m.created_at,m.message_id
                """
                for number, (message, thread, turn, value, created, provider_name) in enumerate(db.execute(query), 1):
                    self.stores[store]["scanned"] += 1
                    provider = "claude" if str(provider_name).lower() == "claudeagent" else "codex"
                    self.add(provider=provider, client="T3 Code", session=thread, timestamp=created,
                             path=path, locator=f"message {number} ({message}; turn {turn})",
                             representation=store, text=str(value or ""), canonical=False)
        except sqlite3.Error:
            self.errors["T3 SQLite"] += 1

    def reconcile(self) -> list[dict]:
        canonical, seen = [], {}
        for row in self.rows:
            key = (
                row["provider"], row["authored_id"]
            ) if row["authored_id"] else (
                row["provider"], row["session"], row["hash"], row["epoch"]
            )
            if key in seen:
                canonical[seen[key]]["copies"].append({k: row[k] for k in ("path", "locator", "representation")})
                self.drops["canonical storage or fork copy"] += 1
            else:
                seen[key] = len(canonical)
                canonical.append(row)

        exact, by_hash = defaultdict(list), defaultdict(list)
        for index, row in enumerate(canonical):
            exact[(row["provider"], row["session"], row["hash"])].append(index)
            by_hash[(row["provider"], row["hash"])].append(index)
        used = set()
        for row in self.projections:
            candidates = [
                index for index in exact.get((row["provider"], row["session"], row["hash"]), [])
                if (row["representation"], index) not in used
            ]
            if not candidates and row["representation"] == "T3 projection" and row["epoch"] is not None:
                candidates = [
                    index for index in by_hash.get((row["provider"], row["hash"]), [])
                    if (row["representation"], index) not in used
                    and canonical[index]["epoch"] is not None
                    and abs(canonical[index]["epoch"] - row["epoch"]) <= 600
                ]
            if candidates:
                index = min(candidates, key=lambda item: abs((canonical[item]["epoch"] or 0) - (row["epoch"] or 0)))
                used.add((row["representation"], index))
                canonical[index]["copies"].append({k: row[k] for k in ("path", "locator", "representation")})
                self.drops["matched projection copy"] += 1
            else:
                canonical.append(row)
        return sorted(canonical, key=lambda row: (row["epoch"] is None, row["epoch"] or 0, row["provider"]))


def self_test():
    assert clean("<system-reminder>x</system-reminder> I want Y") == "I want Y"
    assert clean("<command-name>/mine</command-name><command-args>tools</command-args>") == "/mine tools"
    assert len(digest(" A  B ")) == 64 and digest(" A  B ") == digest("a b")
    assert CONTINUATION.match("This session is being continued from a previous conversation")
    assert UNCERTAIN_AUTHORSHIP.match("# Mission: inspect this")
    assert input_drift({"a": {"size": 1}}, {"a": {"size": 2}}) == ["a"]
    miner = Miner(argparse.Namespace(since=None, until=None, exclude_session=["active"]))
    assert miner.add(provider="codex", client="T3 Code", session="active", timestamp=1000,
                     path=Path("rollout.jsonl"), locator="line 1", representation="Codex rollout",
                     text="mine this", canonical=True) is None
    assert miner.add(provider="codex", client="T3 Code", session="projection", timestamp=1001,
                     path=Path("state.sqlite"), locator="message 1", representation="T3 projection",
                     text="mine this", canonical=False) is None
    assert miner.drops["projection of excluded session"] == 1
    repeated = Miner(argparse.Namespace(since=None, until=None, exclude_session=[]))
    for when in (1000, 2000):
        repeated.add(provider="codex", client="TUI", session="same", timestamp=when,
                     path=Path("rollout.jsonl"), locator=str(when), representation="Codex rollout",
                     text="a genuine repeated statement", canonical=True)
    assert len(repeated.reconcile()) == 2
    repeated.record_session("T3 projection", "thread", title="A title", model="a-model")
    assert repeated.sessions[("T3 projection", "thread")]["model"] == "a-model"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=False)
    parser.add_argument("--since")
    parser.add_argument("--until")
    parser.add_argument("--exclude-session", action="append", default=[])
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("self-test: pass")
        return
    if args.out is None:
        parser.error("--out is required unless --self-test is used")

    miner = Miner(args)
    before_paths = miner.input_paths()
    before = {miner.path(path): file_signature(path) for path in before_paths}
    miner.scan_codex()
    miner.scan_claude()
    miner.scan_projections()
    rows = miner.reconcile()
    after_paths = miner.input_paths()
    after = {miner.path(path): file_signature(path) for path in after_paths}
    drift = input_drift(before, after)
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / "turns.jsonl").open("w", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    with (args.out / "sessions.jsonl").open("w", encoding="utf-8", newline="\n") as stream:
        for row in sorted(miner.sessions.values(), key=lambda item: (item["store"], item["session"])):
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    inventory = {
        "generatedAt": stamp(datetime.now(timezone.utc).timestamp()),
        "command": [sys.executable, *sys.argv],
        "extractorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "window": {"since": args.since, "until": args.until},
        "excludedSessions": args.exclude_session,
        "inputs": {"before": before, "after": after, "drift": drift},
        "retentionBoundaryOnly": True,
        "stores": {key: dict(value) for key, value in sorted(miner.stores.items())},
        "drops": dict(miner.drops),
        "errors": dict(miner.errors),
        "turns": len(rows),
        "sessions": len(miner.sessions),
        "byProvider": dict(Counter(row["provider"] for row in rows)),
        "byClient": dict(Counter(row["client"] for row in rows)),
        "projectionOnly": dict(Counter(row["representation"] for row in rows if row["projection_only"])),
    }
    (args.out / "inventory.json").write_text(
        json.dumps(inventory, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "output": str(args.out),
        "turns": len(rows),
        "sessions": len(miner.sessions),
        "driftedInputs": len(drift),
        "errors": inventory["errors"],
    }))


if __name__ == "__main__":
    main()
