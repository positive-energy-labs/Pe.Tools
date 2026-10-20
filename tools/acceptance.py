"""Native acceptance harness: dev or installed runtime, one controlled Revit on model copies.

    python tools/acceptance.py setup <run> [--installed] [--web] [--foreground] [--detach] [--model PATH[=NAME]]...
    python tools/acceptance.py sdk <run> <name> <pe-revit args...>      envelope -> ev/<name>.json
    python tools/acceptance.py call <run> <who> <METHOD> <path> [body.json] [--out NAME]
    python tools/acceptance.py census <run> [label]
    python tools/acceptance.py teardown <run>

Everything lives under <checkout>/.artifacts/accept/<run>/ (run.json is the custody record).
Dev copies the product home. Installed uses the actual MSI and product home; its writes are censused.
`who` is cli (this host's human/cli context), anon, or ctx:<token>. Teardown stops only the
session ids and host this run recorded; anything else it finds is printed as residue.
"""

import hashlib, json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

CHECKOUT = Path(__file__).resolve().parents[1]
SAMPLE = Path(r"C:\Program Files\Autodesk\Revit 2025\Samples\Snowdon Towers Sample HVAC.rvt")
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


def owner_home() -> Path:
    docs = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return Path(docs) / "Pe.Tools"


def owner_files(roots: list[str]) -> dict:
    files = {}
    for root in roots:
        for dirpath, _, names in os.walk(root):
            for name in names:
                path = os.path.join(dirpath, name)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                files[path] = [stat.st_size, stat.st_mtime_ns]
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
    result = subprocess.run(
        [*command, *args, "--json"],
        cwd=state["installation"]["root"] if installed else CHECKOUT,
        env=env(state), capture_output=True,
    )
    (out / f"{name}.json").write_bytes(result.stdout)
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
    return envelope


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
    # Installed ownership binds content and machine-local state to the canonical MSI root.
    # PE_TOOLS_PRODUCT_HOME would move that root and is deliberately absent in this lane.
    log(run, f"installed {state['installation']['version']}: actual home {state['home']}; writes will be recorded")
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
    old_pids = {p["ProcessId"] for p in state["processesBefore"]}
    state["host"] = {"pid": svc["pid"], "port": svc["port"], "service": svc["file"],
                     "instanceId": svc.get("instanceId"), "owned": svc["pid"] not in old_pids}
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


def http(state: dict, who: str, method: str, path: str, body: bytes | None = None) -> dict:
    svc = service(state)
    if not svc:
        return {"status": None, "body": "no service file for this run lane"}
    headers = {"content-type": "application/json", "accept": "application/json"}
    if who == "cli":
        headers["x-pe-context"] = Path(svc["file"]).with_suffix(".context").read_text().strip()
    elif who.startswith("ctx:"):
        headers["x-pe-context"] = who[4:]
    elif who == "service":
        headers["x-pe-service-token"] = svc["token"]
    request = urllib.request.Request(f"http://127.0.0.1:{svc['port']}{path}", data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    text = raw.decode("utf8", "replace")
    try:
        return {"status": status, "body": json.loads(text)}
    except json.JSONDecodeError:
        return {"status": status, "body": text}


def setup(run: str, args: list[str]) -> None:
    installed = "--installed" in args
    if installed and "--web" in args:
        sys.exit("--web is a checkout frontend option; installed serves its packaged frontend")
    installation = installed_identity() if installed else None
    root = run_dir(run)
    if root.exists():
        sys.exit(f"{root} exists; pick a new run name or tear it down and delete it")
    (root / "ev").mkdir(parents=True)
    (root / "docs").mkdir()
    owner = owner_home()
    home = owner if installed else root / "home" / "Pe.Tools"
    if not installed:
        home.mkdir(parents=True)
    for name in ([] if installed else COPIED):
        source = owner / name
        if source.is_dir():
            shutil.copytree(source, home / name, symlinks=True)
        elif source.is_file():
            shutil.copy2(source, home / name)
    models = [a.split("=", 1) for a in value_list(args, "--model")] or [[str(SAMPLE), "A.rvt"]]
    docs = []
    model_copies = []
    for model in models:
        target = root / "docs" / (model[1] if len(model) > 1 else Path(model[0]).name)
        if installed and (not target.resolve().is_relative_to((root / "docs").resolve()) or target.exists()):
            sys.exit(f"Model destination must be a fresh file under {root / 'docs'}: {target}")
        source = Path(model[0]).resolve()
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        shutil.copy2(source, target)
        target_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        if source_hash != target_hash:
            sys.exit(f"Model copy bytes differ from source: {source} -> {target}")
        model_copies.append({"source": str(source), "copy": str(target),
                             "sourceSha256": source_hash, "copySha256": target_hash})
        docs.append(str(target))
    roots = [str(owner), str(LOCAL)]
    before = root / "owner-before.json"
    before.write_text(json.dumps(owner_files(roots)), encoding="utf8")
    state = {
        "run": run, "checkout": str(CHECKOUT), "home": str(home), "docs": docs,
        "lane": "installed" if installed else "dev", "installation": installation,
        "productHomeIsolated": not installed, "detach": "--detach" in args, "modelCopies": model_copies,
        "ownerRoots": roots, "ownerBefore": str(before), "sessions": [], "host": None,
        "web": "--web" in args,
        "commit": git("rev-parse", "HEAD"), "revitBefore": revit_pids(),
    }
    if installed:
        state["processesBefore"] = processes()
        prior = service(state)
        state["serviceBefore"] = prior
        state["unrelatedServicesBefore"] = owner_files([str(LOCAL / "state" / "service")])
    save(run, state)
    log(run, f"setup {run} at {state['commit']}: home {home}, docs {docs}, Revit before {state['revitBefore']}")

    if installed:
        setup_installed(run, state, args)
        return

    host_log = open(root / "host.log", "ab")
    script = "attach" if state["web"] else "start"
    process = subprocess.Popen(
        [shutil.which("vp") or "vp", "run", script], cwd=CHECKOUT / "ts" / "apps" / "host", env=env(state),
        stdout=host_log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    deadline = time.time() + 180
    while not (svc := service(state)) and time.time() < deadline and process.poll() is None:
        time.sleep(1)
    if not svc:
        sys.exit(f"host did not publish a service file (exit {process.poll()}); see {root / 'host.log'}")
    state["host"] = {"launcher": process.pid, "pid": svc["pid"], "port": svc["port"], "service": svc["file"]}
    if state["web"]:
        # The registered frontend binds its checkout's own port; the attach launcher prints it.
        found = None
        while time.time() < deadline and not (found := re.search(r"Browser: (http\S+)", read_log(root))):
            time.sleep(1)
        state["web"] = found.group(1) if found else None
    save(run, state)
    log(run, f"host pid {svc['pid']} port {svc['port']} ({script}), frontend {state['web']}")

    session = f"acc-{run}"
    window = [] if "--foreground" in args else ["--background"]
    state["sessions"].append(session)
    save(run, state)
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
    for session in state["sessions"]:
        stopped = sdk(run, f"teardown-stop-{session}", ["session", "stop", "--id", session, "--unsaved",
                                                      "keep" if state.get("lane") == "installed" else "discard"])
        if state.get("lane") == "installed" and not sdk_ok(stopped):
            census(run, "teardown-refused")
            sys.exit("Owned installed session did not stop; host preserved; inspect receipt")
    svc = service(state)
    if (svc and state["host"] and state["host"].get("owned", True)
            and svc["pid"] == state["host"]["pid"]
            and (not state["host"].get("instanceId") or svc.get("instanceId") == state["host"]["instanceId"])):
        result = http(state, "service", "POST", "/admin/shutdown", b"{}")
        log(run, f"host shutdown {result['status']}")
        deadline = time.time() + 30
        while pid_alive(svc["pid"]) and time.time() < deadline:
            time.sleep(1)
    census(run, "teardown")
    residue = [p for p in processes() if str(CHECKOUT).lower() in (p.get("CommandLine") or "").lower()]
    revit = [p for p in revit_pids() if p not in state["revitBefore"]]
    log(run, f"teardown residue: {len(residue)} checkout processes {[p['ProcessId'] for p in residue]}, new Revit {revit}")


def processes() -> list[dict]:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"],
        capture_output=True, text=True,
    ).stdout
    return [p for p in json.loads(out or "[]") if p.get("ProcessId") != os.getpid()]


def revit_pids() -> list[int]:
    return [p["ProcessId"] for p in processes() if (p.get("Name") or "").lower() == "revit.exe"]


def pid_alive(pid: int) -> bool:
    return any(p["ProcessId"] == pid for p in processes())


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=CHECKOUT, capture_output=True, text=True).stdout.strip()


def read_log(root: Path) -> str:
    return (root / "host.log").read_text(encoding="utf8", errors="replace")


def value_list(args: list[str], flag: str) -> list[str]:
    return [args[i + 1] for i, a in enumerate(args[:-1]) if a == flag]


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        sys.exit(__doc__)
    verb, run, rest = argv[0], argv[1], argv[2:]
    if verb == "setup":
        setup(run, rest)
    elif verb == "sdk":
        sdk(run, rest[0], rest[1:])
    elif verb == "call":
        who, method, path = rest[:3]
        body = Path(rest[3]).read_bytes() if len(rest) > 3 and rest[3] != "--out" else None
        result = http(load(run), who, method, path, body)
        name = value_list(rest, "--out")
        if name:
            (run_dir(run) / "ev" / f"{name[0]}.json").write_text(json.dumps(result, indent=2), encoding="utf8")
        print(json.dumps(result, indent=2)[:4000])
    elif verb == "census":
        census(run, rest[0] if rest else "census")
    elif verb == "teardown":
        teardown(run)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
