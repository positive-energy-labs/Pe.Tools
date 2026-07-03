/**
 * Settings-prototype route store. Centralizes the document edit loop
 * (selection -> open -> validate -> save) and connection-independent workflow
 * state. Ported from the demo's `@legendapp/state` store to a plain
 * `useSyncExternalStore` store: no new dependency, matches the codebase's
 * store philosophy. One snapshot per change; the route reads it whole.
 */
import { useSyncExternalStore } from "react";

import { callHostRpc } from "#/host/client";
import { type HostIssue, toHostIssue } from "#/host/issues";
import type {
  SaveSettingsDocumentResult,
  SettingsDocumentDependency,
  SettingsDocumentId,
  SettingsDocumentSnapshot,
  SettingsModuleWorkspaceDescriptor,
  SettingsRootDescriptor,
  HostSessionScope,
  SettingsValidationResult,
  SettingsWorkspaceDescriptor,
} from "@pe/host-contracts/operation-types";

type AsyncStatus = "idle" | "loading" | "ready" | "error";
type SaveStatus = "idle" | "saving" | "ready" | "conflict" | "error";

type InternalState = {
  selection: {
    workspaceKey?: string;
    moduleKey?: string;
    rootKey?: string;
    selectedFilePath?: string;
  };
  document: {
    status: AsyncStatus;
    message?: string;
    issue?: HostIssue;
    rawContent: string;
    composedContent: string;
    baselineRawContent: string;
    versionToken?: string;
    dependencies: SettingsDocumentDependency[];
    lastOpenedAt?: string;
    isStale: boolean;
    staleMessage?: string;
  };
  validation: {
    status: AsyncStatus;
    message?: string;
    issue?: HostIssue;
    result?: SettingsValidationResult;
  };
  save: {
    status: SaveStatus;
    message?: string;
    issue?: HostIssue;
    lastSavedAt?: string;
    lastConflictMessage?: string;
  };
};

/** Derived, read-only snapshot the route consumes. */
export type SettingsSnapshot = InternalState & {
  documentId?: SettingsDocumentId;
  parsedRaw?: unknown;
  rawParseStatus: "parsed" | "error";
  rawParseError?: string;
  isDirty: boolean;
  dependencySummary: { total: number };
};

function emptyState(): InternalState {
  return {
    selection: {},
    document: {
      status: "idle",
      rawContent: "",
      composedContent: "",
      baselineRawContent: "",
      dependencies: [],
      isStale: false,
    },
    validation: { status: "idle" },
    save: { status: "idle" },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

class SettingsStore {
  private state = emptyState();
  private snapshot: SettingsSnapshot = this.derive();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SettingsSnapshot => this.snapshot;

  private derive(): SettingsSnapshot {
    const { selection, document } = this.state;
    const documentId: SettingsDocumentId | undefined =
      selection.moduleKey && selection.rootKey && selection.selectedFilePath
        ? {
            moduleKey: selection.moduleKey,
            rootKey: selection.rootKey,
            relativePath: selection.selectedFilePath,
            // ponytail: the host resolves the document by path; stableId is a
            // cache key it fills in. If a live host rejects "", capture and reuse
            // snapshot.metadata.documentId for validate/save.
            stableId: "",
          }
        : undefined;

    let parsedRaw: unknown;
    let rawParseStatus: "parsed" | "error" = "parsed";
    let rawParseError: string | undefined;
    if (document.rawContent.trim()) {
      try {
        parsedRaw = JSON.parse(document.rawContent);
      } catch (error) {
        rawParseStatus = "error";
        rawParseError = error instanceof Error ? error.message : "Invalid JSON";
      }
    } else {
      parsedRaw = {};
    }

    return {
      ...this.state,
      documentId,
      parsedRaw,
      rawParseStatus,
      rawParseError,
      isDirty: document.rawContent !== document.baselineRawContent,
      dependencySummary: { total: document.dependencies.length },
    };
  }

  private commit(mutate: (state: InternalState) => void) {
    mutate(this.state);
    this.snapshot = this.derive();
    for (const listener of this.listeners) listener();
  }

  // --- selection ----------------------------------------------------------

  ensureWorkspaceSelection(workspaces: readonly SettingsWorkspaceDescriptor[]) {
    if (this.state.selection.workspaceKey || workspaces.length === 0) return;
    this.selectWorkspace(workspaces[0]);
  }

  selectWorkspace(workspace?: SettingsWorkspaceDescriptor) {
    this.commit((s) => {
      s.selection = { workspaceKey: workspace?.workspaceKey };
      resetDoc(s);
    });
    const firstModule = workspace?.modules?.[0];
    if (firstModule) this.selectModule(firstModule);
  }

  selectModule(module?: SettingsModuleWorkspaceDescriptor) {
    this.commit((s) => {
      s.selection.moduleKey = module?.moduleKey;
      s.selection.rootKey = undefined;
      s.selection.selectedFilePath = undefined;
      resetDoc(s);
    });
    const defaultRoot =
      module?.roots?.find((r) => r.rootKey === module.defaultRootKey) ?? module?.roots?.[0];
    if (defaultRoot) this.selectRoot(defaultRoot);
  }

  selectRoot(root?: SettingsRootDescriptor) {
    this.commit((s) => {
      s.selection.rootKey = root?.rootKey;
      s.selection.selectedFilePath = undefined;
      resetDoc(s);
    });
  }

  selectFile(relativePath?: string, scope?: HostSessionScope) {
    this.commit((s) => {
      s.selection.selectedFilePath = relativePath;
      resetDoc(s);
    });
    if (relativePath) void this.openSelectedDocument(scope);
  }

  // --- document lifecycle -------------------------------------------------

  async openSelectedDocument(scope?: HostSessionScope) {
    const documentId = this.snapshot.documentId;
    if (!documentId) return;

    this.commit((s) => {
      s.document.status = "loading";
      s.document.message = "Opening document…";
      s.document.issue = undefined;
    });

    try {
      const snapshot = await callHostRpc(
        "settings.document.open",
        {
          documentId,
          includeComposedContent: true,
        },
        scope,
      );
      this.applySnapshot(snapshot);
    } catch (error) {
      const issue = toHostIssue(error, "Open document failed");
      this.commit((s) => {
        s.document.status = "error";
        s.document.message = issue.message;
        s.document.issue = issue;
      });
    }
  }

  refreshCurrentDocument(scope?: HostSessionScope) {
    return this.openSelectedDocument(scope);
  }

  private applySnapshot(snapshot: SettingsDocumentSnapshot) {
    this.commit((s) => {
      s.document.status = "ready";
      s.document.message = "Document loaded.";
      s.document.rawContent = snapshot.rawContent;
      s.document.baselineRawContent = snapshot.rawContent;
      s.document.composedContent = snapshot.composedContent ?? "";
      s.document.dependencies = [...snapshot.dependencies];
      s.document.versionToken = snapshot.metadata.versionToken?.value ?? "";
      s.document.lastOpenedAt = nowIso();
      s.document.isStale = false;
      s.document.staleMessage = undefined;
      s.document.issue = undefined;
      s.validation = { status: "ready", result: snapshot.validation };
      s.save = { status: "idle" };
    });
  }

  async validateDraft(
    rawContent: string,
    scope?: HostSessionScope,
  ): Promise<SettingsValidationResult | undefined> {
    const documentId = this.snapshot.documentId;
    if (!documentId) return undefined;

    this.commit((s) => {
      s.validation.status = "loading";
      s.validation.message = "Validating…";
      s.validation.issue = undefined;
    });

    try {
      const result = await callHostRpc(
        "settings.document.validate",
        { documentId, rawContent },
        scope,
      );
      this.commit((s) => {
        s.validation = { status: "ready", result, issue: undefined };
      });
      return result;
    } catch (error) {
      const issue = toHostIssue(error, "Validation failed");
      this.commit((s) => {
        s.validation.status = "error";
        s.validation.message = issue.message;
        s.validation.issue = issue;
      });
      return undefined;
    }
  }

  async saveDraft(values: Record<string, unknown>, scope?: HostSessionScope) {
    const documentId = this.snapshot.documentId;
    if (!documentId) return;

    const rawContent = `${JSON.stringify(values, null, 2)}\n`;
    this.commit((s) => {
      s.document.rawContent = rawContent;
      s.save = { status: "saving", message: "Saving…", issue: undefined };
    });

    try {
      const result = await callHostRpc(
        "settings.document.save",
        {
          documentId,
          rawContent,
          expectedVersionToken: { value: this.snapshot.document.versionToken ?? "" },
        },
        scope,
      );
      this.applySaveResult(result, rawContent);
    } catch (error) {
      const issue = toHostIssue(error, "Save failed");
      this.commit((s) => {
        s.save = { status: "error", message: issue.message, issue };
      });
    }
  }

  private applySaveResult(result: SaveSettingsDocumentResult, rawContent: string) {
    this.commit((s) => {
      s.validation = { status: "ready", result: result.validation, issue: undefined };
      if (result.conflictDetected) {
        s.save = {
          status: "conflict",
          message: "A newer version exists on the host. Refresh before saving again.",
          issue: {
            kind: "conflict",
            title: "Save conflict",
            message: result.conflictMessage ?? "A newer version exists on the host.",
          },
          lastConflictMessage: result.conflictMessage ?? undefined,
        };
        return;
      }
      if (result.writeApplied) {
        s.document.baselineRawContent = rawContent;
        s.document.versionToken = result.metadata.versionToken?.value ?? "";
        s.save = { status: "ready", message: "Saved.", issue: undefined, lastSavedAt: nowIso() };
      } else {
        s.save = { status: "error", message: "Save was not applied." };
      }
    });
  }

  markStale(message?: string) {
    this.commit((s) => {
      s.document.isStale = true;
      s.document.staleMessage = message ?? "The host document changed. Refresh to reload.";
    });
  }

  clearStale() {
    this.commit((s) => {
      s.document.isStale = false;
      s.document.staleMessage = undefined;
    });
  }
}

function resetDoc(s: InternalState) {
  s.document = {
    status: "idle",
    rawContent: "",
    composedContent: "",
    baselineRawContent: "",
    dependencies: [],
    isStale: false,
  };
  s.validation = { status: "idle" };
  s.save = { status: "idle" };
}

// ponytail: one module-level store instance; this route is a singleton workbench.
export const settingsStore = new SettingsStore();

export function useSettingsSnapshot(): SettingsSnapshot {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  );
}
