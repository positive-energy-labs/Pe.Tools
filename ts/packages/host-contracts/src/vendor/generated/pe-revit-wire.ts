// DO NOT EDIT. Projected from pe-revit-contract.ts by scripts/sdk-wire.ts.
// SDK authority has no verb/result association; unknown payload leaves remain unknown.
export const contractSha256 = "d43eec45607545e270030c011074003662f39712b2490b17b888e53dc411e8b5";
export const wire = {
  "Envelope": {"fields":{"binary":"Binary","command":"CommandContext","diagnostics":{"array":"Diagnostic"},"exitCode":"number","guide":"string","nextSteps":{"array":"string"},"related":{"array":"string"},"resolved":{"union":["null","Resolved"]},"result":"unknown"}},
  "Binary": {"fields":{"assembly":{"union":["null","string"]},"hostExecutable":{"union":["null","string"]},"informationalVersion":{"union":["null","string"]},"origin":{"union":[{"literal":"checkout"},{"literal":"dev-installed"},{"literal":"installed-global"},{"literal":"unknown"}]},"sha256":{"union":["null","string"]}}},
  "CommandContext": {"fields":{"commandManifest":{"union":["null","string"]},"commandRoot":"string","commandRule":"string","cwd":"string"}},
  "Diagnostic": {"fields":{"code":"string","detail":"string","fix":{"union":["null","string"]}}},
  "Resolved": {"fields":{"buildStamp":{"union":["null","string"]},"how":{"union":["null",{"literal":"adopted"},{"literal":"cwd-project"},{"literal":"existing"},{"literal":"implicit-single"},{"literal":"minted"},{"literal":"observed"},{"literal":"pinned"},{"literal":"started"}]},"id":{"union":["null","string"]},"installedRoot":{"union":["null","string"]},"observedAtUtc":{"union":["null","string"]},"origin":{"union":["null","string"]},"payload":{"union":["null","string"]},"pid":{"union":["null","number"]},"processStartUtc":{"union":["null","string"]},"sourceRoot":{"union":["null","string"]}}}
};
