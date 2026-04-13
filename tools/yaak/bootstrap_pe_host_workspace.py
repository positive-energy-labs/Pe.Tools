#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


WORKSPACE_NAME = "Pe.Host Scripting"

GLOBAL_VARIABLES = [
    ("base_url", "http://localhost:5180"),
]


@dataclass(frozen=True)
class FolderSpec:
    name: str
    sort_priority: float


@dataclass(frozen=True)
class RequestSpec:
    folder_name: str
    name: str
    method: str
    url: str
    sort_priority: float
    description: str
    headers: list[dict[str, Any]]


FOLDERS = [
    FolderSpec("Scripting", 100.0),
]

JSON_HEADERS = [{"enabled": True, "name": "Content-Type", "value": "application/json"}]

REQUESTS = [
    RequestSpec(
        "Scripting",
        "Workspace Bootstrap",
        "POST",
        "${[ base_url ]}/api/scripting/workspace/bootstrap",
        100.0,
        "Body: ScriptWorkspaceBootstrapRequest. Requires exactly one connected Revit session.",
        JSON_HEADERS,
    ),
    RequestSpec(
        "Scripting",
        "Execute Script",
        "POST",
        "${[ base_url ]}/api/scripting/execute",
        110.0,
        "Body: ExecuteRevitScriptRequest. Returns final buffered output and structured diagnostics.",
        JSON_HEADERS,
    ),
]


class YaakCli:
    def __init__(self, data_dir: str | None) -> None:
        cli = self._find_cli()
        if cli is None:
            raise RuntimeError("Could not find Yaak's CLI executable.")

        self._cli = cli
        self._data_dir = data_dir

    @staticmethod
    def _find_cli() -> str | None:
        direct_exe = shutil.which("yaak.exe")
        if direct_exe is not None:
            return direct_exe

        wrapper = shutil.which("yaakcli.cmd") or shutil.which("yaakcli")
        if wrapper is None:
            return None

        vite_plus_root = Path(wrapper).resolve().parent.parent
        matches = sorted(
            vite_plus_root.glob(
                "js_runtime/node/*/node_modules/@yaakapp/cli/node_modules/@yaakapp/cli-win32-x64/bin/yaak.exe"
            )
        )
        if matches:
            return str(matches[-1])

        return wrapper

    def _build_command(self, *args: str) -> list[str]:
        command = [self._cli]
        if self._data_dir:
            command.extend(["--data-dir", self._data_dir])

        command.extend(args)
        return command

    def run(self, *args: str) -> str:
        result = subprocess.run(
            self._build_command(*args),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"yaakcli {' '.join(args)} failed with exit code {result.returncode}:\n{result.stderr.strip()}"
            )

        return result.stdout.strip()

    def show_json(self, resource: str, resource_id: str) -> dict[str, Any]:
        return json.loads(self.run(resource, "show", resource_id))

    def update_json(self, resource: str, payload: dict[str, Any]) -> None:
        self.run(resource, "update", "--json", json.dumps(payload, separators=(",", ":")))

    def list_ids(self, resource: str, workspace_id: str | None = None) -> list[str]:
        args = [resource, "list"]
        if workspace_id:
            args.append(workspace_id)

        output = self.run(*args)
        if not output:
            return []

        ids: list[str] = []
        for line in output.splitlines():
            match = re.match(r"^(?P<id>\S+)\s+-\s+.+$", line.strip())
            if match is None:
                continue

            ids.append(match.group("id"))

        return ids


def ensure_workspace(cli: YaakCli, workspace_name: str) -> dict[str, Any]:
    for workspace_id in cli.list_ids("workspace"):
        workspace = cli.show_json("workspace", workspace_id)
        if workspace.get("name") == workspace_name:
            return workspace

    cli.run("workspace", "create", "-n", workspace_name)
    for workspace_id in cli.list_ids("workspace"):
        workspace = cli.show_json("workspace", workspace_id)
        if workspace.get("name") == workspace_name:
            return workspace

    raise RuntimeError(f"Workspace '{workspace_name}' was not created.")


def ensure_global_variables(cli: YaakCli, workspace_id: str) -> None:
    environments = [cli.show_json("environment", environment_id) for environment_id in cli.list_ids("environment", workspace_id)]
    global_environment = next(
        (environment for environment in environments if environment.get("name") == "Global Variables"),
        None,
    )

    if global_environment is None:
        raise RuntimeError("Could not find Yaak's 'Global Variables' environment.")

    variables = global_environment.get("variables") or []
    by_name = {
        variable.get("name"): variable
        for variable in variables
        if isinstance(variable, dict) and variable.get("name")
    }

    merged_variables: list[dict[str, Any]] = []
    for name, value in GLOBAL_VARIABLES:
        variable = by_name.pop(name, {"name": name})
        variable["enabled"] = True
        variable["name"] = name
        variable["value"] = value
        merged_variables.append(variable)

    merged_variables.extend(by_name.values())
    global_environment["variables"] = merged_variables
    cli.update_json("environment", global_environment)


def ensure_folders(cli: YaakCli, workspace_id: str) -> dict[str, dict[str, Any]]:
    folders_by_name = {
        folder.get("name"): folder
        for folder_id in cli.list_ids("folder", workspace_id)
        for folder in [cli.show_json("folder", folder_id)]
    }

    for folder_spec in FOLDERS:
        folder = folders_by_name.get(folder_spec.name)
        if folder is None:
            cli.run("folder", "create", workspace_id, "-n", folder_spec.name)
            folders_by_name = {
                folder.get("name"): folder
                for folder_id in cli.list_ids("folder", workspace_id)
                for folder in [cli.show_json("folder", folder_id)]
            }
            folder = folders_by_name[folder_spec.name]

        folder["sortPriority"] = folder_spec.sort_priority
        folder["description"] = ""
        cli.update_json("folder", folder)

    return folders_by_name


def ensure_requests(cli: YaakCli, workspace_id: str, folders_by_name: dict[str, dict[str, Any]]) -> None:
    requests_by_name = {
        request.get("name"): request
        for request_id in cli.list_ids("request", workspace_id)
        for request in [cli.show_json("request", request_id)]
    }

    for request_spec in REQUESTS:
        request = requests_by_name.get(request_spec.name)
        if request is None:
            cli.run(
                "request",
                "create",
                workspace_id,
                "-n",
                request_spec.name,
                "-m",
                request_spec.method,
                "-u",
                request_spec.url,
            )
            requests_by_name = {
                request.get("name"): request
                for request_id in cli.list_ids("request", workspace_id)
                for request in [cli.show_json("request", request_id)]
            }
            request = requests_by_name[request_spec.name]

        request["folderId"] = folders_by_name[request_spec.folder_name]["id"]
        request["method"] = request_spec.method
        request["name"] = request_spec.name
        request["url"] = request_spec.url
        request["description"] = request_spec.description
        request["headers"] = request_spec.headers
        request["sortPriority"] = request_spec.sort_priority
        cli.update_json("request", request)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create or update a Yaak workspace for Pe.Host scripting endpoints.")
    parser.add_argument(
        "--data-dir",
        default=None,
        help="Optional custom Yaak data directory. Defaults to Yaak's normal data store.",
    )
    parser.add_argument(
        "--workspace-name",
        default=WORKSPACE_NAME,
        help=f"Workspace name to create or update. Default: {WORKSPACE_NAME}",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cli = YaakCli(args.data_dir)

    workspace = ensure_workspace(cli, args.workspace_name)
    ensure_global_variables(cli, workspace["id"])
    folders_by_name = ensure_folders(cli, workspace["id"])
    ensure_requests(cli, workspace["id"], folders_by_name)

    print(f"Workspace ready: {workspace['name']} ({workspace['id']})")
    print(f"Requests seeded: {len(REQUESTS)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as ex:
        print(str(ex), file=sys.stderr)
        raise SystemExit(1)
