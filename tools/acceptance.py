"""Native acceptance harness: one isolated copied home, one controlled Revit on model copies.

    python tools/acceptance.py setup <run> [--web PORT] [--foreground] [--model PATH[=NAME]]...
    python tools/acceptance.py sdk <run> <name> <pe-revit args...>      envelope -> ev/<name>.json
    python tools/acceptance.py call <run> <who> <METHOD> <path> [body.json] [--out NAME]
    python tools/acceptance.py census <run> [label]
    python tools/acceptance.py teardown <run>

Everything lives under <checkout>/.artifacts/accept/<run>/ (run.json is the custody record).
The owner's product home and machine-local root are only read, before and after, never written.
`who` is cli (this host's human/cli context), anon, or ctx:<token>. Teardown stops only the
session ids and host this run recorded; anything else it finds is printed as residue.
"""

import json, os, shutil, subprocess, sys, time, urllib.error, urllib.request
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
    extra = {"PE_TOOLS_PRODUCT_HOME": state["home"]}
    if state.get("web"):
        extra["PE_TOOLS_WEB_PORT"] = str(state["web"]["port"])
    return dict(os.environ, **extra)


def sdk(run: str, name: str, args: list[str]) -> dict:
    state = load(run)
    out = run_dir(run) / "ev"
    result = subprocess.run(
        ["dotnet", "tool", "run", "pe-revit", "--", *args, "--json"],
        cwd=CHECKOUT, env=env(state), capture_output=True,
    )
    (out / f"{name}.json").write_bytes(result.stdout)
    (out / f"{name}.stderr").write_bytes(result.stderr)
    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError:
        log(run, f"sdk {name}: exit {result.returncode}, no envelope (see ev/{name}.stderr)")
        return {}
    codes = [d.get("code") for d in envelope.get("diagnostics") or []]
    log(run, f"sdk {name}: exit {result.returncode} state={(envelope.get('result') or {}).get('state')} {codes}")
    return envelope


def service(state: dict) -> dict | None:
    folder = Path(state["home"]) / ".local-state" / "state" / "service"
    for file in folder.glob("host-source-*.json"):
        data = json.loads(file.read_text(encoding="utf8"))
        if "port" in data and Path(data.get("sourceRoot") or "/").resolve() == CHECKOUT:
            return dict(data, file=str(file))
    return None


def http(state: dict, who: str, method: str, path: str, body: bytes | None = None) -> dict:
    svc = service(state)
    if not svc:
        return {"status": None, "body": "no service file for this checkout"}
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
    root = run_dir(run)
    if root.exists():
        sys.exit(f"{root} exists; pick a new run name or tear it down and delete it")
    (root / "ev").mkdir(parents=True)
    (root / "docs").mkdir()
    owner = owner_home()
    home = root / "home" / "Pe.Tools"
    home.mkdir(parents=True)
    for name in COPIED:
        source = owner / name
        if source.is_dir():
            shutil.copytree(source, home / name, symlinks=True)
        elif source.is_file():
            shutil.copy2(source, home / name)
    models = [a.split("=", 1) for a in value_list(args, "--model")] or [[str(SAMPLE), "A.rvt"]]
    docs = []
    for model in models:
        target = root / "docs" / (model[1] if len(model) > 1 else Path(model[0]).name)
        shutil.copy2(model[0], target)
        docs.append(str(target))
    roots = [str(owner), str(LOCAL)]
    before = root / "owner-before.json"
    before.write_text(json.dumps(owner_files(roots)), encoding="utf8")
    web = value_list(args, "--web")
    state = {
        "run": run, "checkout": str(CHECKOUT), "home": str(home), "docs": docs,
        "ownerRoots": roots, "ownerBefore": str(before), "sessions": [], "host": None,
        "web": {"port": int(web[0])} if web else None,
        "commit": git("rev-parse", "HEAD"), "revitBefore": revit_pids(),
    }
    save(run, state)
    log(run, f"setup {run} at {state['commit']}: home {home}, docs {docs}, Revit before {state['revitBefore']}")

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
    save(run, state)
    log(run, f"host pid {svc['pid']} port {svc['port']} ({script})")

    session = f"acc-{run}"
    window = [] if "--foreground" in args else ["--background"]
    state["sessions"].append(session)
    save(run, state)
    sdk(run, "session-start", ["session", "start", "--id", session, "--year", "2025", "--quarantine", *window])
    for i, doc in enumerate(docs):
        # Copied models keep their link paths; a link that did not travel stays unloaded.
        sdk(run, f"doc-open-{i}", ["doc", "open", doc, "--id", session, "--links", "allow",
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
    log(run, f"{label}: owner +{len(diff['added'])} -{len(diff['removed'])} ~{len(diff['changed'])}; "
             f"host {'pid ' + str(svc['pid']) if svc else 'absent'}; Revit {revit_pids()}")


def teardown(run: str) -> None:
    state = load(run)
    for session in state["sessions"]:
        sdk(run, f"teardown-stop-{session}", ["session", "stop", "--id", session, "--unsaved", "discard"])
    svc = service(state)
    if svc and state["host"] and svc["pid"] == state["host"]["pid"]:
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
