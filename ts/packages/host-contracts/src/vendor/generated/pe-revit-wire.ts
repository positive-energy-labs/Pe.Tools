// DO NOT EDIT. Projected from pe-revit-contract.ts by scripts/sdk-wire.ts.
// SDK authority has no verb/result association; unknown payload leaves remain unknown.
import type * as SDK from "./pe-revit-contract.ts";
export interface SelectedSdkTypes {
  readonly SessionListResult: SDK.SessionListResult;
  readonly SessionObservation: SDK.SessionObservation;
  readonly ProcessIdentity: SDK.ProcessIdentity;
  readonly DocumentInfo: SDK.DocumentInfo;
  readonly SessionDocument: SDK.SessionDocument;
  readonly DocumentHoldings: SDK.DocumentHoldings;
  readonly Holdings: SDK.Holdings;
  readonly UpdatePlan: SDK.UpdatePlan;
  readonly UpdateReceipt: SDK.UpdateReceipt;
}
export const contractSha256 = "d43eec45607545e270030c011074003662f39712b2490b17b888e53dc411e8b5";
export const wire = {
  "Envelope": {"fields":{"binary":"Binary","command":"CommandContext","diagnostics":{"array":"Diagnostic"},"exitCode":"number","guide":"string","nextSteps":{"array":"string"},"related":{"array":"string"},"resolved":{"union":["null","Resolved"]},"result":"unknown"}},
  "Binary": {"fields":{"assembly":{"union":["null","string"]},"hostExecutable":{"union":["null","string"]},"informationalVersion":{"union":["null","string"]},"origin":{"union":[{"literal":"checkout"},{"literal":"dev-installed"},{"literal":"installed-global"},{"literal":"unknown"}]},"sha256":{"union":["null","string"]}}},
  "CommandContext": {"fields":{"commandManifest":{"union":["null","string"]},"commandRoot":"string","commandRule":"string","cwd":"string"}},
  "Diagnostic": {"fields":{"code":"string","detail":"string","fix":{"union":["null","string"]}}},
  "Resolved": {"fields":{"buildStamp":{"union":["null","string"]},"how":{"union":["null",{"literal":"adopted"},{"literal":"cwd-project"},{"literal":"existing"},{"literal":"implicit-single"},{"literal":"minted"},{"literal":"observed"},{"literal":"pinned"},{"literal":"started"}]},"id":{"union":["null","string"]},"installedRoot":{"union":["null","string"]},"observedAtUtc":{"union":["null","string"]},"origin":{"union":["null","string"]},"payload":{"union":["null","string"]},"pid":{"union":["null","number"]},"processStartUtc":{"union":["null","string"]},"sourceRoot":{"union":["null","string"]}}},
  "SessionListResult": {"fields":{"phase":{"union":[{"literal":"no-sessions"},{"literal":"ok"}]},"processReadErrors":{"array":"ProcessReadError"},"quarantines":{"array":"QuarantineObservation"},"registryRoot":"string","requestId":{"union":["null","string"]},"sessions":{"array":{"union":["ControlledPending","ControlledActive","ObservedActive","GoneReceipt","FailedReceipt"]}},"state":{"union":[{"literal":"ok"},{"literal":"bad-invocation"},{"literal":"failed"},{"literal":"refused"}]},"unreadableReceipts":{"array":"UnreadableSessionReceipt"}}},
  "ProcessReadError": {"fields":{"candidatePid":"number","detail":"string","observedAtUtc":"string"}},
  "QuarantineObservation": {"fields":{"sessionId":"string","year":"string"}},
  "ControlledPending": {"fields":{"case":{"literal":"controlled-pending"},"attempt":{"union":["AwaitingLaunch","LaunchedPending"]},"detail":"string","execution":{"union":["null","SessionExecution"]},"id":"string","observedAtUtc":"string","origin":"string","project":{"union":["null","string"]},"receipt":{"union":["CheckoutReceipt","InstalledReceipt"]},"shape":"SessionShape","worktree":"string","year":"number"}},
  "AwaitingLaunch": {"fields":{"attempt":{"literal":"awaiting-launch"}}},
  "LaunchedPending": {"fields":{"attempt":{"literal":"launched"},"bridge":{"union":["AnsweringBridgeObservation","MissingBridgeEndpoint"]},"process":"ProcessIdentity"}},
  "AnsweringBridgeObservation": {"fields":{"bridge":{"literal":"answering"},"sessionDescriptor":{"union":["null","string"]}}},
  "MissingBridgeEndpoint": {"fields":{"bridge":{"literal":"missing-endpoint"}}},
  "ProcessIdentity": {"fields":{"executable":"string","pid":"number","processStartUtc":"string"}},
  "SessionExecution": {"fields":{"allowed":{"union":[{"literal":false},{"literal":true}]},"code":{"union":["null","string"]},"detail":{"union":["null","string"]}}},
  "CheckoutReceipt": {"fields":{"payload":{"literal":"checkout"},"buildStamp":{"union":["null","string"]},"generationId":"string","generationRoot":"string","overridePath":{"union":["null","string"]},"receiptPath":"string"}},
  "InstalledReceipt": {"fields":{"payload":{"literal":"installed"},"generationRoot":"string","receiptPath":"string"}},
  "SessionShape": {"fields":{"payload":{"union":[{"literal":"checkout"},{"literal":"installed"}]},"posture":{"union":[{"literal":"background"},{"literal":"foreground"}]},"purpose":{"union":[{"literal":"interactive"},{"literal":"test-run"}]},"quarantine":{"union":[{"literal":false},{"literal":true}]},"reload":{"union":[{"literal":"hot"},{"literal":"none"}]}}},
  "ControlledActive": {"fields":{"case":{"literal":"controlled-active"},"bridge":{"union":["ReadyBridgeObservation","UnresponsiveBridgeEndpoint"]},"detail":"string","dialogs":{"union":["null","DialogSnapshot"]},"execution":{"union":["null","SessionExecution"]},"id":"string","observedAtUtc":"string","origin":"string","process":"ProcessIdentity","project":{"union":["null","string"]},"receipt":{"union":["CheckoutReceipt","InstalledReceipt"]},"shape":"SessionShape","worktree":"string","year":"number"}},
  "ReadyBridgeObservation": {"fields":{"bridge":{"literal":"ready"},"documents":{"union":["null",{"array":"DocumentInfo"}]},"modal":{"union":["null","ModalObservation"]},"privateBytes":{"union":["null","number"]},"queue":{"union":["null","QueueObservation"]},"sessionDescriptor":{"union":["null","string"]},"unresponsive":{"union":[{"literal":false},{"literal":true}]}}},
  "DocumentInfo": {"fields":{"centralFreshnessAtObservation":{"union":["null","string"]},"centralPath":{"union":["null","string"]},"isActive":{"union":[{"literal":false},{"literal":true}]},"isCloud":{"union":["null",{"literal":false},{"literal":true}]},"isDetached":{"union":["null",{"literal":false},{"literal":true}]},"isFamily":{"union":[{"literal":false},{"literal":true}]},"isModified":{"union":[{"literal":false},{"literal":true}]},"isWorkshared":{"union":["null",{"literal":false},{"literal":true}]},"modelGuid":{"union":["null","string"]},"observedAtUtc":{"union":["null","string"]},"openId":{"union":["null","string"]},"path":{"union":["null","string"]},"persistence":{"union":["null","string"]},"projectGuid":{"union":["null","string"]},"region":{"union":["null","string"]},"supportedActions":{"union":["null",{"array":"string"}]},"title":{"union":["null","string"]},"window":{"union":["null","string"]}}},
  "ModalObservation": {"fields":{"class":{"union":["null","string"]},"handle":{"union":["null","number"]},"title":{"union":["null","string"]}}},
  "QueueObservation": {"fields":{"depth":"number","health":"string","lastTickUtc":{"union":["null","string"]},"runningKey":{"union":["null","string"]},"runningRequestId":{"union":["null","string"]},"runningStartedUtc":{"union":["null","string"]}}},
  "UnresponsiveBridgeEndpoint": {"fields":{"bridge":{"literal":"unresponsive-endpoint"}}},
  "DialogSnapshot": {"fields":{"state":"string","windows":{"array":"SessionDialogInfo"}}},
  "SessionDialogInfo": {"fields":{"childTexts":{"array":"string"},"handle":"string","identity":{"union":["null","SessionDialogIdentity"]},"modal":{"union":[{"literal":false},{"literal":true}]},"title":"string","windowClass":"string"}},
  "SessionDialogIdentity": {"fields":{"childTextDigest":"string","childTexts":{"array":"string"},"handle":"string","lifetime":"string","modal":{"union":[{"literal":false},{"literal":true}]},"observationId":"string","observedAtUtc":"string","ownerTitle":"string","pid":"number","processStartUtc":"string","title":"string","windowClass":"string"}},
  "ObservedActive": {"fields":{"case":{"literal":"observed-active"},"bridge":{"union":["AnsweringBridgeObservation","MissingBridgeEndpoint","UnresponsiveBridgeEndpoint"]},"execution":{"union":["null","SessionExecution"]},"observedAtUtc":"string","process":"ProcessIdentity","shape":"SessionShape","year":"number"}},
  "GoneReceipt": {"fields":{"case":{"literal":"gone-receipt"},"detail":"string","execution":{"union":["null","SessionExecution"]},"id":"string","observedAtUtc":"string","origin":"string","process":"ProcessIdentity","project":{"union":["null","string"]},"receipt":{"union":["CheckoutReceipt","InstalledReceipt"]},"shape":"SessionShape","worktree":"string","year":"number"}},
  "FailedReceipt": {"fields":{"case":{"literal":"failed-receipt"},"detail":"string","execution":{"union":["null","SessionExecution"]},"failure":{"union":["PersistedFailure","JournalFailure"]},"id":"string","observedAtUtc":"string","origin":"string","project":{"union":["null","string"]},"receipt":{"union":["CheckoutReceipt","InstalledReceipt"]},"shape":"SessionShape","worktree":"string","year":"number"}},
  "PersistedFailure": {"fields":{"source":{"literal":"receipt"},"failure":"SessionFailureInfo"}},
  "SessionFailureInfo": {"fields":{"atUtc":"string","code":"string","detail":"string"}},
  "JournalFailure": {"fields":{"source":{"literal":"journal"},"event":"string","journalFile":"string","message":{"union":["null","string"]},"process":"ProcessIdentity"}},
  "UnreadableSessionReceipt": {"fields":{"detail":"string","fix":"string","id":"string","observedAtUtc":"string","receiptPath":"string","schemaVersion":{"union":["null","number"]}}},
  "SessionObservation": {"union":["ControlledPending","ControlledActive","ObservedActive","GoneReceipt","FailedReceipt"]},
  "SessionDocument": {"fields":{"centralPath":{"union":["null","string"]},"isActive":{"union":[{"literal":false},{"literal":true}]},"isCloud":{"union":["null",{"literal":false},{"literal":true}]},"isDetached":{"union":["null",{"literal":false},{"literal":true}]},"isFamily":{"union":[{"literal":false},{"literal":true}]},"isModified":{"union":[{"literal":false},{"literal":true}]},"isWorkshared":{"union":["null",{"literal":false},{"literal":true}]},"modelGuid":{"union":["null","string"]},"openId":{"union":["null","string"]},"path":{"union":["null","string"]},"projectGuid":{"union":["null","string"]},"region":{"union":["null","string"]},"sessionId":"string","title":{"union":["null","string"]},"window":{"union":["null","string"]}}},
  "DocumentHoldings": {"fields":{"holdings":"Holdings","openId":"string","title":"string"}},
  "Holdings": {"fields":{"elements":{"array":"HeldElement"},"empty":{"union":[{"literal":false},{"literal":true}]},"savedNotSynced":{"union":["null",{"literal":false},{"literal":true}]},"unsaved":{"union":[{"literal":false},{"literal":true}]},"worksets":{"array":"string"},"workshared":{"union":[{"literal":false},{"literal":true}]}}},
  "HeldElement": {"fields":{"category":{"union":["null","string"]},"changedSinceSync":{"union":["null",{"literal":false},{"literal":true}]},"id":"number","name":{"union":["null","string"]},"requesters":{"array":"string"}}},
  "UpdatePlan": {"fields":{"available":{"union":[{"literal":false},{"literal":true}]},"blockers":{"array":"UpdateBlocker"},"current":"string","effects":"UpdateEffects","feed":"string","installedRoot":{"union":["null","string"]},"latest":{"union":["null","string"]},"msi":{"union":["null","UpdateAsset"]},"observedAtUtc":"string","planId":"string","product":"string","quiet":{"union":[{"literal":false},{"literal":true}]},"revits":{"array":"UpdateRevit"}}},
  "UpdateBlocker": {"fields":{"code":"string","detail":"string"}},
  "UpdateEffects": {"fields":{"close":{"array":"UpdateProcess"},"reopen":{"array":"string"},"restartYears":{"array":"number"}}},
  "UpdateProcess": {"fields":{"pid":"number","processStartUtc":{"union":["null","string"]}}},
  "UpdateAsset": {"fields":{"digest":"string","name":"string","size":"number","url":"string"}},
  "UpdateRevit": {"fields":{"answering":{"union":[{"literal":false},{"literal":true}]},"blockers":{"array":"UpdateBlocker"},"custody":"string","documents":{"array":"UpdateDocument"},"idle":{"union":[{"literal":false},{"literal":true}]},"modal":"unknown","pid":"number","processStartUtc":{"union":["null","string"]},"queue":"unknown","sessionId":{"union":["null","string"]},"unknown":{"union":[{"literal":false},{"literal":true}]},"year":"number"}},
  "UpdateDocument": {"fields":{"central":{"union":["null","string"]},"isModified":{"union":[{"literal":false},{"literal":true}]},"openId":{"union":["null","string"]},"path":{"union":["null","string"]},"persistence":{"union":["null","string"]},"reopenSource":{"union":["null","string"]},"title":{"union":["null","string"]}}},
  "UpdateReceipt": {"fields":{"legs":{"array":"UpdateLeg"},"planId":"string","receiptPath":"string","reopen":{"array":"string"},"requestId":"string","restartYears":{"array":"number"},"state":"string","stub":{"union":["null","UpdateProcess"]}}},
  "UpdateLeg": {"fields":{"detail":{"union":["null","string"]},"exitCode":{"union":["null","number"]},"name":"string","observedAtUtc":"string","status":"string"}}
};
