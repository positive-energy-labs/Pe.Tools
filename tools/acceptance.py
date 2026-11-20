"""Native acceptance harness: dev or installed runtime, one controlled Revit on model copies.

    python tools/acceptance.py setup <run> [--installed] [--web] [--host-only] [--foreground] [--detach] [--model PATH[=NAME]]... [--wait-admission MINUTES]
    python tools/acceptance.py sdk <run> <name> <pe-revit args...>      envelope -> ev/<name>.json
    python tools/acceptance.py call <run> <who> <METHOD> <path> [body.json] [--out NAME]
    python tools/acceptance.py census <run> [label]
    python tools/acceptance.py teardown <run>
    python tools/acceptance.py run <run> -- <command...>

Evidence lives under <checkout>/.artifacts/accept/<run>/ (run.json is the custody record).
The isolated dev product home lives under the system temp directory, outside the checkout.
Without --model, setup copies the Chadds model from the main checkout's .artifacts/revit/detached, or refuses.
Dev copies the product home. Installed uses the actual MSI and product home; its writes are censused.
--host-only starts a dev host with an empty isolated home and no pre-launched Revit or models.
`who` is cli (this host's human/cli context), anon, or ctx:<token>.
Setup snapshots existing processes and TCP listeners. SDK actions and host calls refuse
protected targets. Use explicit SDK targets when another Revit was present at setup.
Commands append to ev/commands.jsonl with argv, cwd, local start/end, exitCode and output.
Run streams a trusted driver command in the caller's cwd with the run environment
and returns its exit code.
Use machine.py run for reservations, and the sdk and call verbs for guarded dispatch.
--wait-admission re-reads the machine every 30 s until it admits or the minutes run out, so a
drive starts when memory frees. Teardown stops only the sessions and host it already owns.
It prints and writes ev/teardown.json with observed stops, surviving recorded PIDs and
listeners, checkout status, and private home existence after cleanup. Owned browser receipts
in the isolated home supply PIDs and ports. A browser started outside that home can be
recorded in run.json under "browser" with its pid and optional port.
"""

import hashlib, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from itertools import batched
from pathlib import Path
from urllib.parse import urlsplit

CHECKOUT = Path(__file__).resolve().parents[1]
# Local fixture in the main checkout's ignored artifacts; never searched for. Without it, --model is required.
DEFAULT_MODEL = Path(".artifacts/revit/detached/MEP_YoramLePairArchitects_ChaddsFord_R25_standalone_20261019.rvt")
COPIED = ["Pods", "Pages", ".agents", ".claude", ".codex", ".pea", "settings", "preferences.json", "AGENTS.md"]
LOCAL = Path(os.environ["LOCALAPPDATA"]) / "Positive Energy" / "Pe.Tools"


def run_dir(run: str) -> Path:
    return CHECKOUT / ".artifacts" / "accept" / run


def load(run: str) -> dict:
    return json.loads((run_dir(run) / "run.json").read_text(encoding="utf8"))


def save(run: str, state: dict) -> None:
    (run_dir(run) / "run.json").write_text(json.dumps(state, indent=2), encoding="utf8")


def log(run: str, text: str) -> None:
    line = f"- {time.strftime('%Y-%m-%dT%H:%M:%S')} {text}"
    print(line, flush=True)
    with (run_dir(run) / "LOG.md").open("a", encoding="utf8") as f:
        f.write(line + "\n")


@contextmanager
def command_record(run: str, argv: list[str], cwd: Path, output: Path | None = None):
    start = datetime.now().astimezone().isoformat()
    record = {"argv": argv, "cwd": str(cwd), "start": start, "exitCode": 0}
    try:
        yield record
    except SystemExit as error:
        record["exitCode"] = error.code if isinstance(error.code, int) else int(error.code is not None)
        raise
    except KeyboardInterrupt:
        record["exitCode"] = 130
        raise
    except Exception:
        record["exitCode"] = 1
        raise
    finally:
        record["end"] = datetime.now().astimezone().isoformat()
        record.setdefault("output", str(output) if output is not None and output.is_file() else None)
        path = run_dir(run) / "ev" / "commands.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("ab", buffering=0) as file:
            if os.name == "nt":
                import msvcrt
                # Windows CRT append seeks then writes. Serialize the append on this file.
                file.seek(0)
                msvcrt.locking(file.fileno(), msvcrt.LK_LOCK, 1)
            file.write((json.dumps(record) + "\n").encode("utf8"))


def owner_home() -> Path:
    # The user root (ADR 0035 rule 11): the Documents known folder's Pe.Tools, OneDrive when it redirects.
    docs = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return Path(docs) / "Pe.Tools"


def pod_build_skip(pods: Path):
    # Old Pod build output is 1.5 GB of the 1.9 GB home and is rebuilt by the run: skip Pods/<pod>/output, obj, bin.
    def skip(directory: str, names: list[str]) -> set[str]:
        pod_dir = Path(directory).parent == pods
        return {n for n in names if n in ("obj", "bin") or (pod_dir and n == "output")}
    return skip


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def copy_hashed(source: Path, target: Path) -> str:
    """Copy source to target and return the source's sha256, from one read of the source."""
    digest = hashlib.sha256()
    with source.open("rb") as r, target.open("wb") as w:
        while chunk := r.read(1 << 20):
            digest.update(chunk)
            w.write(chunk)
    shutil.copystat(source, target)
    return digest.hexdigest()


def main_checkout() -> Path:
    return Path(git("rev-parse", "--path-format=absolute", "--git-common-dir")).parent


def pick_models(args: list[str], default: Path) -> list[list[str]]:
    given = [m.split("=", 1) for m in value_list(args, "--model")]
    if given:
        return given
    if default.is_file():
        return [[str(default), "A.rvt"]]
    sys.exit(f"No --model given and no default model at {default}; pass --model PATH[=NAME]")


def owner_files(roots: list[str]) -> dict:
    def read(path):
        # Fresh stat preserves post-enumeration edits and per-file failures.
        try:
            stat = os.stat(path)
        except OSError:
            return None
        return path, [stat.st_size, stat.st_mtime_ns]

    files = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for root in roots:
            for dirpath, _, names in os.walk(root):
                for batch in batched(names, 64):
                    for entry in pool.map(read, (os.path.join(dirpath, name) for name in batch)):
                        if entry is not None:
                            path, metadata = entry
                            files[path] = metadata
    return files


def owner_diff(state: dict) -> dict:
    before = json.loads(Path(state["ownerBefore"]).read_text(encoding="utf8"))
    after = owner_files(state["ownerRoots"])
    return {
        "added": sorted(set(after) - set(before)),
        "removed": sorted(set(before) - set(after)),
        "changed": sorted(p for p in set(before) & set(after) if before[p] != after[p]),
    }


def env(state: dict) -> dict:
    result = dict(os.environ)
    if state.get("lane") == "installed":
        for key in ("PE_TOOLS_PRODUCT_HOME", "PE_TOOLS_SOURCE_ROOT", "PE_TOOLS_HOST_SERVICE_NAME",
                    "PE_TOOLS_FRONTEND_BASE_URL", "PE_TOOLS_HOST_BASE_URL", "PE_TOOLS_HOST_EXECUTABLE_PATH"):
            result.pop(key, None)
        result["PE_LANE"] = "installed"
    else:
        result["PE_TOOLS_PRODUCT_HOME"] = state["home"]
    return result


def sdk(run: str, name: str, args: list[str]) -> dict:
    state = load(run)
    out = run_dir(run) / "ev"
    installed = state.get("lane") == "installed"
    command = ([state["installation"]["sdk"], "--installed"] if installed
               else ["dotnet", "tool", "run", "pe-revit", "--"])
    argv = [*command, *args, "--json"]
    cwd = Path(state["installation"]["root"] if installed else state.get("checkout", CHECKOUT))
    with command_record(run, argv, cwd) as record:
        guard_sdk(run, name, state, args)
        result = subprocess.run(argv, cwd=cwd, env=env(state), capture_output=True)
        record["exitCode"] = result.returncode
        stdout = out / f"{name}.json"
        stdout.write_bytes(result.stdout)
        record["output"] = str(stdout)
        (out / f"{name}.stderr").write_bytes(result.stderr)
    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError:
        log(run, f"sdk {name}: exit {result.returncode}, no envelope (see ev/{name}.stderr)")
        return {}
    if installed and result.returncode == 0:
        context = envelope.get("command") or {}
        if (context.get("commandRule") != "installed-executable"
                or not same_path(context.get("commandRoot"), state["installation"]["root"])
                or (envelope.get("binary") or {}).get("origin") != "installed-global"):
            raise RuntimeError(f"SDK {name} did not answer from the installed resolver; see its saved envelope")
    codes = [d.get("code") for d in envelope.get("diagnostics") or []]
    log(run, f"sdk {name}: exit {result.returncode} state={(envelope.get('result') or {}).get('state')} {codes}")
    record_revit(run, state, envelope)
    return envelope


def refuse_owner(state: dict, pid: int | None = None, port: int | None = None) -> None:
    sockets = state.get("listenersBefore", [])
    if pid is not None and (pid in state.get("revitBefore", [])
                            or any(pid == p["ProcessId"] for p in state.get("processesBefore", []))
                            or any(pid == row["pid"] for row in sockets)):
        sys.exit(f"Refusing to target owner process {pid} present before setup")
    if port is not None and any(port == row["port"] for row in sockets):
        sys.exit(f"Refusing to target owner port {port} listening before setup")


def session_pid(row: dict) -> int | None:
    # Active, launched-pending, and journal-failed observations carry the process in different arms.
    process = row.get("process") or (row.get("attempt") or {}).get("process") or (row.get("failure") or {}).get("process")
    return (process or {}).get("pid")


def guard_sdk(run: str, name: str, state: dict, args: list[str]) -> None:
    # The SDK owns target resolution and process identity. Use its census for a named target.
    verb = list(args)
    while verb and verb[0] in ("--installed", "--json", "--plan"):
        verb.pop(0)
    family, action = (verb + ["", ""])[:2]
    if "update" in args and "apply" in args and "--plan" not in args:
        if state.get("processesBefore") or state.get("revitBefore"):
            sys.exit("Refusing SDK update apply while this run protects pre-existing owner processes")
    if "-h" in args or "--help" in args:
        return
    if ((family, action) in (("session", "list"), ("session", "logs"), ("op", "list"))
            or family == "test" and "--attach" not in args
            or "--plan" in args and (family == "start" or (family, action) == ("session", "start"))):
        return
    if family not in ("session", "doc", "op", "test", "start", "stop", "hr", "open") and not family.startswith("-"):
        return
    pids = value_list(args, "--pid")
    for pid in pids:
        if pid.isdecimal():
            refuse_owner(state, pid=int(pid))
    if not state.get("revitBefore"):
        return
    if (family, action) in (("op", "cancel"), ("op", "wait")):
        sys.exit(f"Refusing SDK op {action}: its request ID may target the owner's Revit")
    if pids and pids[-1].isdecimal():
        return
    ids = value_list(args, "--id")
    if not ids or (family, action) == ("op", "result"):
        sys.exit(f"Refusing SDK {family} {action}: select a target away from the owner's Revit")
    observed = sdk(run, f"{name}-guard", ["session", "list", "--id", ids[-1]])
    census = observed.get("result") or {}
    for row in census.get("sessions", []):
        refuse_owner(state, pid=session_pid(row))
    missing = any(d.get("code") == "session.no-match" for d in observed.get("diagnostics") or [])
    if (not (sdk_ok(observed) or missing) or census.get("unreadableReceipts") or census.get("processReadErrors")):
        sys.exit(f"Refusing SDK {family} {action}: cannot verify session {ids[-1]} against the owner snapshot")


def record_revit(run: str, state: dict, envelope: dict) -> None:
    result = envelope.get("result") or {}
    resolved = envelope.get("resolved") or {}
    rows = result.get("sessions") or ([result["session"]] if result.get("session") else [])
    targets = [(resolved.get("id"), resolved.get("pid")),
               *((row.get("id"), session_pid(row)) for row in rows)]
    owned = {name.lower() for name in state.get("sessions", [])}
    found = {pid for name, pid in targets if pid and name and name.lower() in owned} - set(state.get("revitBefore", []))
    if found - set(state.get("revitPids", [])):
        current = load(run)
        current["revitPids"] = sorted(found | set(current.get("revitPids", [])))
        save(run, current)


def service(state: dict) -> dict | None:
    installed = state.get("lane") == "installed"
    folder = (Path(state["installation"]["root"]) if installed
              else Path(state["home"]) / ".local-state") / "state" / "service"
    if installed:
        file = folder / "host.json"
        if not file.exists():
            return None
        data = json.loads(file.read_text(encoding="utf8"))
        if (data.get("lane") != "installed" or data.get("sourceRoot")
                or not same_path(data.get("executablePath"), state["installation"]["host"])):
            raise RuntimeError(f"Installed service ownership mismatch: {file}")
        return dict(data, file=str(file))
    for file in folder.glob("host-source-*.json"):
        data = json.loads(file.read_text(encoding="utf8"))
        if "port" in data and Path(data.get("sourceRoot") or "/").resolve() == CHECKOUT:
            return dict(data, file=str(file))
    return None


def same_path(left: str | None, right: str) -> bool:
    return bool(left) and os.path.normcase(os.path.abspath(left)) == os.path.normcase(os.path.abspath(right))


def installed_identity() -> dict:
    manifest = LOCAL / "product.payloads.json"
    data = json.loads(manifest.read_text(encoding="utf8"))
    if data.get("product") != "Pe.Tools" or data.get("vendor") != "Positive Energy":
        raise RuntimeError(f"Unexpected installed manifest: {manifest}")
    payloads = data["payloads"]
    cli = next(p for p in payloads if p["type"] == "Cli" and p["name"] == "pe-revit")
    host = next(p for p in payloads if p["type"] == "VersionedApp" and p["name"] == "host")
    pea = next(p for p in payloads if p["type"] == "VersionedApp" and p["name"] == "pea")
    paths = {"manifest": manifest, "sdk": LOCAL / "shims" / (cli["name"] + ".exe"),
             "host": LOCAL / "bin" / host["name"] / host["entry"],
             "pea": LOCAL / "bin" / pea["name"] / pea["entry"]}
    for path in paths.values():
        if not path.is_file() or not path.resolve().is_relative_to(LOCAL.resolve()):
            raise RuntimeError(f"Missing or noncanonical installed payload: {path}")
    return {"root": str(LOCAL), "version": data.get("version"),
            **{name: str(path) for name, path in paths.items()},
            "sha256": {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in paths.items()}}


def sdk_ok(envelope: dict) -> bool:
    return envelope.get("exitCode") == 0


def setup_installed(run: str, state: dict, args: list[str]) -> None:
    # Installed machine state belongs to the canonical MSI root; content uses the user root.
    # PE_TOOLS_PRODUCT_HOME would move that root and is deliberately absent in this lane.
    log(run, f"installed {state['installation']['version']}: actual home {state['home']}; writes will be recorded")
    prior_host = state["serviceBefore"] or {}
    refuse_owner(state, prior_host.get("pid"), prior_host.get("port"))
    before = sdk(run, "sessions-before", ["session", "list", "--all"])
    if not sdk_ok(before):
        sys.exit("Installed SDK census failed; no session was started")
    session = f"acc-{run}"
    prior = before.get("result") or {}
    if prior.get("processReadErrors"):
        sys.exit("Installed process census is incomplete; no session was started")
    if any(row.get("id", "").lower() == session.lower()
           for row in [*prior.get("sessions", []), *prior.get("unreadableReceipts", [])]):
        sys.exit(f"Session {session} already exists; choose a new run name")
    window = [] if "--foreground" in args else ["--background"]
    start = ["session", "start", "--installed", "--id", session, "--year", "2025", *window]
    plan = sdk(run, "session-start-plan", [*start, "--plan"])
    result = plan.get("result") or {}
    if (not sdk_ok(plan) or result.get("phase") != "planned"
            or (result.get("shape") or {}).get("payload") != "installed"):
        sys.exit("Installed session plan did not establish installed payload; no session was started")
    state["sessions"].append(session)
    save(run, state)  # Retain custody even if startup times out after acquiring the session.
    started = sdk(run, "session-start", start)
    if not sdk_ok(started):
        sys.exit("Installed start failed; inspect session-start receipt and run census/teardown")
    state = load(run)
    resolved = started.get("resolved") or {}
    if resolved.get("payload") != "installed" or not same_path(resolved.get("installedRoot"), state["installation"]["root"]):
        sys.exit("SDK start identity differs from installed root; inspect receipt before further work")
    deadline = time.time() + 60
    svc = service(state)
    while not svc and time.time() < deadline:
        time.sleep(1)
        svc = service(state)
    if not svc:
        sys.exit("Installed payload did not bootstrap canonical host; inspect session and dialogs")
    refuse_owner(state, svc["pid"], svc["port"])
    state["host"] = {"pid": svc["pid"], "port": svc["port"], "service": svc["file"],
                     "instanceId": svc.get("instanceId"), "owned": True}
    state["web"] = f"http://127.0.0.1:{svc['port']}"
    save(run, state)
    status = http(state, "anon", "GET", "/host/status")
    (run_dir(run) / "ev" / "host-status.json").write_text(json.dumps(status, indent=2), encoding="utf8")
    body = status.get("body") or {}
    if (status.get("status") != 200 or not isinstance(body, dict) or body.get("lane") != "installed"
            or body.get("sourceRoot") or body.get("serviceName") != "host"
            or body.get("processId") != svc["pid"]
            or not same_path(body.get("installedRoot"), state["installation"]["root"])
            or not same_path(body.get("executablePath"), state["installation"]["host"])):
        sys.exit("Installed host status identity mismatch; no model opened")
    for i, doc in enumerate(state["docs"]):
        opened = sdk(run, f"doc-open-{i}", ["doc", "open", doc, "--id", session, "--links", "allow",
                                           *(["--detach"] if state.get("detach") else []),
                                           *(["--window", "headless"] if window else [])])
        if not sdk_ok(opened):
            sys.exit(f"Opening model copy {i} failed; inspect its receipt before continuing")
    census(run, "setup")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # The service file only authorizes requests to its own endpoint.


def http(state: dict, who: str, method: str, path: str, body: bytes | None = None, *, svc=None) -> dict:
    if not path.startswith("/"):
        sys.exit("Host call path must begin with /")
    svc = svc or service(state)
    if not svc:
        return {"status": None, "body": "no service file for this run lane"}
    refuse_owner(state, svc["pid"], svc["port"])
    headers = {"content-type": "application/json", "accept": "application/json"}
    if who == "cli":
        headers["x-pe-context"] = Path(svc["file"]).with_suffix(".context").read_text().strip()
    elif who.startswith("ctx:"):
        headers["x-pe-context"] = who[4:]
    elif who == "service":
        headers["x-pe-service-token"] = svc["token"]
    request = urllib.request.Request(f"http://127.0.0.1:{svc['port']}{path}", data=body, method=method, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=300) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    text = raw.decode("utf8", "replace")
    try:
        return {"status": status, "body": json.loads(text)}
    except json.JSONDecodeError:
        return {"status": status, "body": text}


def require_setup_admission(kind: str, wait_minutes: float = 0) -> None:
    # Point-in-time check only, not a reservation or memory cap over persistent SDK services.
    deadline = time.time() + wait_minutes * 60
    while True:
        refused = admission_refusal(kind)
        if not refused:
            return
        if time.time() >= deadline:
            sys.exit(refused)
        time.sleep(30)


def admission_refusal(kind: str) -> str | None:
    try:
        reading = subprocess.run(
            [sys.executable, str(CHECKOUT / ".agents/skills/slot.execute/machine.py"),
             "admit", kind, "--json"],
            capture_output=True, text=True, timeout=8,
        )
        verdict = json.loads(reading.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        return f"HOLD setup: machine admission failed: {error}"
    if (reading.returncode != 0 or not isinstance(verdict, dict)
            or verdict.get("verdict") != "ADMIT" or verdict.get("kind") != kind
            or "error" in verdict):
        return f"HOLD setup: machine admission refused: {reading.stdout.strip()}"
    return None


def setup(run: str, args: list[str]) -> None:
    wait = value_list(args, "--wait-admission")
    # A host-only drive starts no Revit, so it takes the host+web+Chrome floor (owner, 2026-11-20: "more like 8, maybe 6"), not the cold-drive floor.
    kind = "browser" if "--host-only" in args else "revit-drive"
    require_setup_admission(kind, float(wait[0]) if wait else 0)  # Includes the host-timeout resume path, before discovery or acquisition.
    installed = "--installed" in args
    host_only = "--host-only" in args
    if host_only and (installed or "--model" in args):
        sys.exit("--host-only requires dev and takes no models")
    owner = None if host_only else owner_home()
    if installed and "--web" in args:
        sys.exit("--web is a checkout frontend option; installed serves its packaged frontend")
    installation = installed_identity() if installed else None
    root = run_dir(run)
    if root.exists() and any(p.name != "ev" for p in root.iterdir()):
        prior = load(run) if (root / "run.json").exists() else {}
        host = prior.get("host") or {}
        if "launcher" in host and "pid" not in host and not prior["sessions"]:  # a wait that timed out
            if prior.get("hostOnly", False) != host_only:
                sys.exit("Resume with the same --host-only setting as the original run")
            log(run, f"resume: adopting the host of launcher {host['launcher']}")
            adopt_host(run, prior, host["launcher"], lambda: pid_alive(host["launcher"]))
            if not host_only:
                dev_session(run, prior, args)
            return
        sys.exit(f"{root} exists; pick a new run name or tear it down and delete it")
    models = [] if host_only else pick_models(args, main_checkout() / DEFAULT_MODEL)
    existing_listeners = listeners()
    listener_pids = {row["pid"] for row in existing_listeners}
    owner_processes = [{"ProcessId": p["ProcessId"], "Name": p["Name"]} for p in processes()
                       if p["ProcessId"] in listener_pids or is_revit(p) or (p.get("Name") or "").lower() == "pe.host.exe"]
    (root / "ev").mkdir(parents=True, exist_ok=True)
    (root / "docs").mkdir()
    home = owner if installed else Path(tempfile.mkdtemp(prefix="pe-accept-")) / "Pe.Tools"
    if not installed:
        home.mkdir(parents=True)
    for name in ([] if installed or host_only else COPIED):
        source = owner / name
        destination = home / name
        if os.name == "nt":
            destination = Path("\\\\?\\" + str(destination))
        if source.is_dir():
            shutil.copytree(source, destination, symlinks=True,
                            ignore=pod_build_skip(source) if name == "Pods" else None)
        elif source.is_file():
            shutil.copy2(source, destination)
    docs = []
    model_copies = []
    for model in models:
        target = root / "docs" / (model[1] if len(model) > 1 else Path(model[0]).name)
        if installed and (not target.resolve().is_relative_to((root / "docs").resolve()) or target.exists()):
            sys.exit(f"Model destination must be a fresh file under {root / 'docs'}: {target}")
        source = Path(model[0]).resolve()
        source_hash = copy_hashed(source, target)
        target_hash = sha256_file(target)  # the written bytes, read back: the copy proof stays independent
        if source_hash != target_hash:
            sys.exit(f"Model copy bytes differ from source: {source} -> {target}")
        model_copies.append({"source": str(source), "copy": str(target),
                             "sourceSha256": source_hash, "copySha256": target_hash})
        docs.append(str(target))
    roots = [] if host_only else [str(owner), str(LOCAL)]
    before = root / "owner-before.json"
    before.write_text(json.dumps(owner_files(roots)), encoding="utf8")
    state = {
        "run": run, "checkout": str(CHECKOUT), "home": str(home), "docs": docs,
        "lane": "installed" if installed else "dev", "installation": installation,
        "productHomeIsolated": not installed, "detach": "--detach" in args, "modelCopies": model_copies,
        "ownerRoots": roots, "ownerBefore": str(before), "sessions": [], "host": None,
        "web": "--web" in args, "hostOnly": host_only,
        "commit": git("rev-parse", "HEAD"), "revitBefore": [p["ProcessId"] for p in owner_processes if is_revit(p)],
        "processesBefore": owner_processes, "listenersBefore": existing_listeners,
    }
    if installed:
        state["serviceBefore"] = service(state)
        state["unrelatedServicesBefore"] = owner_files([str(LOCAL / "state" / "service")])
    save(run, state)
    log(run, f"setup {run} at {state['commit']}: home {home}, docs {docs}, Revit before {state['revitBefore']}")

    if installed:
        setup_installed(run, state, args)
        return

    script = "attach" if state["web"] else "start"
    with (root / "host.log").open("ab") as host_log:
        process = subprocess.Popen(
            [shutil.which("vp") or "vp", "run", script], cwd=CHECKOUT / "ts" / "apps" / "host", env=env(state),
            stdout=host_log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    adopt_host(run, state, process.pid, lambda: process.poll() is None)
    if not host_only:
        dev_session(run, state, args)


def adopt_host(run: str, state: dict, launcher: int, launcher_alive, patience: int = 180) -> None:
    """Record the launcher, wait for its host to publish a service file, record the host.
    On timeout with the launcher alive, exit leaving run.json resumable: `setup <run>` again adopts it."""
    root = run_dir(run)
    web = state["web"]
    state["host"] = {"launcher": launcher}  # before the wait: a timeout must not leave the host unrecorded
    save(run, state)
    deadline = time.time() + patience
    while not (svc := service(state)) and time.time() < deadline and launcher_alive():
        time.sleep(1)
    if not svc:
        why = (f"is still booting after {patience}s; run `setup {run}` again to adopt it, never start a second host"
               if launcher_alive() else "exited without a service file")
        sys.exit(f"host launcher {launcher} {why}; see {root / 'host.log'}")
    refuse_owner(state, svc["pid"], svc["port"])
    state["host"] = {"launcher": launcher, "pid": svc["pid"], "port": svc["port"], "service": svc["file"]}
    if web:
        # The registered frontend binds its checkout's own port; the attach launcher prints it.
        found = None
        while time.time() < deadline and not (found := re.search(r"Browser: (http\S+)", read_log(root))):
            time.sleep(1)
        state["web"] = found.group(1) if found else None
    save(run, state)
    log(run, f"host pid {svc['pid']} port {svc['port']} ({'attach' if web else 'start'}), frontend {state['web']}")


def dev_session(run: str, state: dict, args: list[str]) -> None:
    docs = state["docs"]
    session = f"acc-{run}"
    window = [] if "--foreground" in args else ["--background"]
    state["sessions"].append(session)
    save(run, state)
    # TODO: T-1: --quarantine is always passed, and one session holds the 2025 add-in quarantine lease at a
    # time, so one fresh pe-revit test anywhere refuses every acceptance drive (session.quarantine-unavailable).
    # machine.py admit cannot see the lease, so it admits a drive that cannot start.
    # TODO: L2b: this start's result is not checked, so a refused start still ends setup with exit 0 and no
    # session; setup_installed refuses on the same failure. Seen in pod-pages drive/f1/setup-1-quarantine-unavailable.log.
    sdk(run, "session-start", ["session", "start", "--id", session, "--year", "2025", "--quarantine", *window])
    for i, doc in enumerate(docs):
        # Copied models keep their link paths; a link that did not travel stays unloaded.
        sdk(run, f"doc-open-{i}", ["doc", "open", doc, "--id", session, "--links", "allow",
                                   *(["--detach"] if state.get("detach") else []),
                                   *(["--window", "headless"] if window else [])])
    census(run, "setup")


def census(run: str, label: str = "census") -> None:
    state = load(run)
    for session in state["sessions"]:
        sdk(run, f"{label}-session-{session}", ["session", "list", "--id", session])
        sdk(run, f"{label}-docs-{session}", ["doc", "list", "--id", session])
        sdk(run, f"{label}-dialogs-{session}", ["session", "dialogs", "--id", session])
    diff = owner_diff(state)
    (run_dir(run) / "ev" / f"{label}-owner-diff.json").write_text(json.dumps(diff, indent=2), encoding="utf8")
    svc = service(state)
    if state.get("lane") == "installed":
        before = state["unrelatedServicesBefore"]
        after = owner_files([str(LOCAL / "state" / "service")])
        own_service = str(LOCAL / "state" / "service" / "host")
        foreign = {p: {"before": before.get(p), "after": after.get(p)}
                   for p in set(before) | set(after)
                   if not (p == own_service or p.startswith(own_service + "."))
                   and before.get(p) != after.get(p)}
        observation = {"missingPriorRevit": sorted(set(state["revitBefore"]) - set(revit_pids())),
                       "unrelatedServiceChanges": foreign, "productHomeIsolated": False}
        (run_dir(run) / "ev" / f"{label}-custody.json").write_text(json.dumps(observation, indent=2), encoding="utf8")
    log(run, f"{label}: owner +{len(diff['added'])} -{len(diff['removed'])} ~{len(diff['changed'])}; "
             f"host {'pid ' + str(svc['pid']) if svc else 'absent'}; Revit {revit_pids()}")


def teardown(run: str) -> None:
    state = load(run)
    sessions_stopped = []
    browser_pids, browser_ports = set(), set()
    try:
        for session in state["sessions"]:
            stopped = sdk(run, f"teardown-stop-{session}", ["session", "stop", "--id", session, "--unsaved",
                                                          "keep" if state.get("lane") == "installed" else "discard"])
            result = stopped.get("result") or {}
            if (sdk_ok(stopped) and result.get("phase") == "stopped"
                    and result.get("id", "").lower() == session.lower()):
                sessions_stopped.append(session)
            elif state.get("lane") == "installed":
                census(run, "teardown-refused")
                sys.exit("Owned installed session did not stop; host preserved; inspect receipt")
        svc = service(state)
        if (svc and state["host"] and state["host"].get("owned", True)
                and svc["pid"] == state["host"].get("pid")  # absent while a timed-out launcher is unadopted
                and (not state["host"].get("instanceId") or svc.get("instanceId") == state["host"]["instanceId"])):
            result = http(state, "service", "POST", "/admin/shutdown", b"{}", svc=svc)
            log(run, f"host shutdown {result['status']}")
            deadline = time.time() + 30
            while pid_alive(svc["pid"]) and time.time() < deadline:
                time.sleep(1)
        census(run, "teardown")
    finally:
        try:
            browser_pids, browser_ports = browser_targets(state)
        finally:
            try:
                clean_home(state)
            finally:
                teardown_receipt(run, load(run), sessions_stopped, browser_pids, browser_ports)


def browser_targets(state: dict) -> tuple[set[int], set[int]]:
    browser = state.get("browser") or {}
    pids, ports = {browser.get("pid")}, {browser.get("port")}
    if state.get("lane") != "installed":
        folder = Path(state["home"]) / ".local-state" / "state" / "browser"
        for file in folder.glob("*/*.json"):
            if file.name not in ("session.json", "terminal.json"):
                continue
            receipt = json.loads(file.read_bytes())
            info = receipt["info"]
            if info["custody"] == "owned":
                pids.update(info.get(key) for key in ("pid", "guardianPid", "keeperPid"))
                ports.update((receipt.get("controlPort"), urlsplit(info.get("endpoint") or "").port))
    return pids - {None}, ports - {None, 0}


def teardown_receipt(run: str, state: dict, sessions_stopped: list[str],
                     browser_pids: set[int], browser_ports: set[int]) -> None:
    checkout = Path(state.get("checkout", CHECKOUT))
    host = state.get("host") or {}
    pids = set(state.get("revitPids", [])) | browser_pids | {host.get("launcher"), host.get("pid")}
    web_port = urlsplit(state["web"]).port if isinstance(state.get("web"), str) else None
    ports = browser_ports | {host.get("port"), web_port}
    active = processes()
    live_pids = {p["ProcessId"] for p in active}
    receipt = {"run": run, "lane": state.get("lane"), "commit": state.get("commit"),
               "sessionsStopped": sessions_stopped, "hostPid": host.get("pid"),
               "hostAlive": host.get("pid") in live_pids,
               "newRevit": [p["ProcessId"] for p in active if is_revit(p) and p["ProcessId"] not in state["revitBefore"]],
               "residue": [p["ProcessId"] for p in active if str(checkout).lower() in (p.get("CommandLine") or "").lower()],
               "livePids": sorted(live_pids & pids),
               "listeners": [row for row in listeners() if row["pid"] in pids or row["port"] in ports],
               "gitStatus": git("status", "--porcelain", cwd=checkout),
               "privateHomeExists": state.get("lane") != "installed" and Path(state["home"]).exists(),
               "sourceModelsUnchanged": all(sha256_file(Path(m["source"])) == m["sourceSha256"]
                                            for m in state.get("modelCopies", []))}
    (run_dir(run) / "ev").mkdir(parents=True, exist_ok=True)
    (run_dir(run) / "ev" / "teardown.json").write_text(json.dumps(receipt, indent=2), encoding="utf8")
    print(json.dumps(receipt))


def clean_home(state: dict) -> None:
    if state.get("lane") != "installed" and os.environ.get("PE_ACCEPT_KEEP_HOME") != "1":
        # Only remove the system-temp container created by setup, never an arbitrary saved home.
        home = Path(state["home"]).resolve()
        container = home.parent
        if (home.name == "Pe.Tools" and container.name.startswith("pe-accept-")
                and container.parent == Path(tempfile.gettempdir()).resolve()):
            target = str(container)
            if os.name == "nt" and not target.startswith("\\\\?\\"):
                # Recording history can exceed MAX_PATH; container is already resolved and guarded.
                target = "\\\\?\\UNC\\" + target[2:] if target.startswith("\\\\") else "\\\\?\\" + target
            try:
                shutil.rmtree(target)
            except FileNotFoundError:
                if container.exists():
                    raise


def powershell_rows(query: str) -> list[dict]:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; "
         f"ConvertTo-Json -Compress -InputObject @({query})"],
        capture_output=True, encoding="utf8", check=True,
    ).stdout
    return json.loads(out)


def processes() -> list[dict]:
    rows = powershell_rows("Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine")
    return [p for p in rows if p["ProcessId"] != os.getpid()]


def listeners() -> list[dict]:
    rows = powershell_rows("Get-NetTCPConnection | Where-Object State -eq Listen | "
                           "Select-Object LocalAddress,LocalPort,OwningProcess")
    return [{"pid": row["OwningProcess"], "address": row["LocalAddress"], "port": row["LocalPort"]} for row in rows]


def is_revit(p: dict) -> bool:
    return (p.get("Name") or "").lower() == "revit.exe"


def revit_pids() -> list[int]:
    return [p["ProcessId"] for p in processes() if is_revit(p)]


def pid_alive(pid: int) -> bool:
    return any(p["ProcessId"] == pid for p in processes())


def git(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(["git", *args], cwd=cwd or CHECKOUT, capture_output=True,
                          text=True, check=True).stdout.rstrip("\r\n")


def read_log(root: Path) -> str:
    return (root / "host.log").read_text(encoding="utf8", errors="replace")


def value_list(args: list[str], flag: str) -> list[str]:
    return [args[i + 1] for i, a in enumerate(args[:-1]) if a == flag]


def main(argv: list[str]) -> None:
    if any(arg in ("-h", "--help") for arg in argv[:2]):
        print(__doc__)
        return
    if len(argv) < 2:
        sys.exit(__doc__)
    verb, run, rest = argv[0], argv[1], argv[2:]
    if verb == "sdk":
        sdk(run, rest[0], rest[1:])
        return
    if verb == "run":
        if len(rest) < 2 or rest[0] != "--":
            sys.exit("Usage: acceptance.py run <run> -- <command...>")
        state = load(run)
        cwd = Path.cwd()
        with command_record(run, rest[1:], cwd):
            sys.exit(subprocess.run(rest[1:], cwd=cwd, env=env(state)).returncode)
    if verb not in ("setup", "call", "census", "teardown"):
        sys.exit(__doc__)
    root = run_dir(run)
    name = value_list(rest, "--out") if verb == "call" else []
    output = {"setup": root / "host.log", "teardown": root / "ev" / "teardown.json"}.get(verb)
    if name:
        output = root / "ev" / f"{name[0]}.json"
    with command_record(run, [sys.executable, str(Path(__file__).resolve()), *argv], Path.cwd(), output):
        if verb == "setup":
            setup(run, rest)
        elif verb == "call":
            who, method, path = rest[:3]
            body = Path(rest[3]).read_bytes() if len(rest) > 3 and rest[3] != "--out" else None
            result = http(load(run), who, method, path, body)
            if output:
                output.write_text(json.dumps(result, indent=2), encoding="utf8")
            print(json.dumps(result, indent=2)[:4000])
        elif verb == "census":
            census(run, rest[0] if rest else "census")
        else:
            teardown(run)


if __name__ == "__main__":
    main(sys.argv[1:])
