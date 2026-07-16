import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Box, Braces, Hammer, ScanLine } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { callHostRpc } from "#/host/client";
import {
  buildFamilyModelPreview,
  parseFamilyModel,
  type FamilyModelPreview,
} from "#/family-model/preview";

export const Route = createFileRoute("/family-model")({ component: FamilyModelRoute });

const STARTER = `{
  "family": {
    "name": "FF Minimal Box",
    "category": "Generic Models",
    "template": "Generic Model",
    "placement": "Unhosted"
  },
  "familyParameters": {
    "Width": { "dataType": "Length (Common)", "value": "12in" },
    "Depth": { "dataType": "Length (Common)", "value": "8in" },
    "Height": { "dataType": "Length (Common)", "value": "6in" }
  },
  "types": { "Default": {} },
  "solids": {
    "body": { "kind": "Prism", "frame": "frame:family", "width": "param:Width", "depth": "param:Depth", "height": "param:Height" }
  },
  "roomCalculationPoint": { "enabled": true }
}`;

function FamilyModelRoute() {
  const [source, setSource] = useState(STARTER);
  const [selectedType, setSelectedType] = useState<string>();
  const [outputPath, setOutputPath] = useState("");
  const [modelDirectory, setModelDirectory] = useState("");
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => {
    try {
      const model = parseFamilyModel(source);
      return { preview: buildFamilyModelPreview(model, selectedType) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [selectedType, source]);

  async function capture() {
    setBusy(true);
    setStatus(undefined);
    try {
      const result = await callHostRpc("family.model.capture", {});
      setSource(result.modelJson);
      setSelectedType(undefined);
      setStatus(`Captured ${result.familyName} · ${result.unmodeledCount} unmodeled`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    if (!outputPath.trim()) {
      setStatus("Choose an explicit .rfa output path first.");
      return;
    }
    setBusy(true);
    setStatus(undefined);
    try {
      const result = await callHostRpc("family.model.build", {
        modelJson: source,
        outputPath,
        modelDirectory: modelDirectory.trim() || undefined,
        overwrite: false,
      });
      setStatus(`Built ${result.familyName} → ${result.outputPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#08110f] text-[#e8ead7]">
      <header className="border-b border-[#9dc88d]/25 bg-[#0b1714]/95">
        <div className="page-wrap flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              aria-label="Back to tools"
              className="grid size-9 place-items-center rounded-md text-[#9dc88d] hover:bg-[#9dc88d]/10 hover:text-[#d9f4c9]"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#d9a441]">
                Family Foundry / portable truth
              </p>
              <h1 className="text-xl font-semibold tracking-tight">Family Model drafting table</h1>
            </div>
          </div>
          <Button
            onClick={() => void capture()}
            disabled={busy}
            className="bg-[#d9a441] text-[#08110f] hover:bg-[#efbd57]"
          >
            <ScanLine className="size-4" /> Capture active family
          </Button>
        </div>
      </header>

      <div className="page-wrap grid gap-5 py-5 xl:grid-cols-[minmax(340px,0.78fr)_minmax(520px,1.22fr)]">
        <section className="overflow-hidden rounded-sm border border-[#9dc88d]/25 bg-[#0d1b17] shadow-2xl shadow-black/30">
          <div className="flex items-center justify-between border-b border-[#9dc88d]/20 px-4 py-3">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-[#9dc88d]">
              <Braces className="size-4" /> family.json
            </div>
            <label className="cursor-pointer text-xs text-[#d9a441] hover:text-[#efbd57]">
              Open file
              <input
                className="sr-only"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then(setSource);
                }}
              />
            </label>
          </div>
          <textarea
            aria-label="Family Model JSON"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            className="h-[56vh] min-h-[420px] w-full resize-y bg-transparent p-4 font-mono text-[12px] leading-5 text-[#d9dfc5] outline-none selection:bg-[#d9a441]/35"
          />
          <div className="grid gap-2 border-t border-[#9dc88d]/20 p-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <Input
                value={outputPath}
                onChange={(event) => setOutputPath(event.target.value)}
                placeholder="Output: C:\\...\\family.rfa"
                aria-label="RFA output path"
                className="border-[#9dc88d]/25 bg-black/20 font-mono text-xs"
              />
              <Input
                value={modelDirectory}
                onChange={(event) => setModelDirectory(event.target.value)}
                placeholder="Model folder (required when family.json has dependencies)"
                aria-label="Family Model directory"
                className="border-[#9dc88d]/25 bg-black/20 font-mono text-xs"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void build()}
              disabled={busy || Boolean(parsed.error)}
              className="border-[#d9a441]/50 text-[#efbd57] hover:bg-[#d9a441]/10 hover:text-[#ffd27a]"
            >
              <Hammer className="size-4" /> Build RFA
            </Button>
          </div>
          {status && (
            <p className="border-t border-[#9dc88d]/15 px-4 py-2 font-mono text-[11px] text-[#c8d9bc]">
              {status}
            </p>
          )}
        </section>

        {parsed.preview ? (
          <PreviewBoard
            preview={parsed.preview}
            selectedType={selectedType}
            onType={setSelectedType}
          />
        ) : (
          <section className="grid min-h-[420px] place-items-center rounded-sm border border-[#d5634a]/40 bg-[#1c1210] p-10 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-3 size-7 text-[#e98068]" />
              <p className="font-mono text-sm text-[#f1b1a2]">{parsed.error}</p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function PreviewBoard({
  preview,
  selectedType,
  onType,
}: {
  preview: FamilyModelPreview;
  selectedType?: string;
  onType: (value: string) => void;
}) {
  const typeNames = Object.keys(preview.model.types ?? {});
  return (
    <section className="relative overflow-hidden rounded-sm border border-[#9dc88d]/25 bg-[#e7e5cf] text-[#14211c] shadow-2xl shadow-black/30">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(#587361_1px,transparent_1px),linear-gradient(90deg,#587361_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="relative border-b-2 border-[#14211c] p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#6d5b26]">
              {preview.model.family.category} · {preview.model.family.placement}
            </p>
            <h2 className="mt-1 text-3xl font-black uppercase tracking-[-0.04em]">
              {preview.model.family.name}
            </h2>
          </div>
          {typeNames.length > 0 && (
            <select
              value={selectedType ?? preview.typeName}
              onChange={(event) => onType(event.target.value)}
              className="border-2 border-[#14211c] bg-[#f2f0dc] px-3 py-1.5 font-mono text-xs font-bold uppercase"
            >
              <option disabled>Type</option>
              {typeNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="relative grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="border-b-2 border-[#14211c] p-5 lg:border-b-0 lg:border-r-2">
          <PlanSvg preview={preview} />
          <p className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#596b5f]">
            <Box className="size-3" /> Family-frame extents · dimensions in inches
          </p>
        </div>
        <div className="divide-y-2 divide-[#14211c]">
          <div className="p-4">
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              Parameters / {preview.typeName}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(preview.parameters).map(([name, value]) => (
                <div key={name} className="contents">
                  <span className="truncate text-xs">{name}</span>
                  <span className="text-right font-mono text-xs font-bold">
                    {typeof value === "number" ? `${Number(value.toFixed(3))}″` : value}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-4">
            <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              Constituent register
            </p>
            <div className="space-y-3">
              {preview.groups
                .filter((group) => group.names.length)
                .map((group) => (
                  <div key={group.label}>
                    <span className="font-mono text-[9px] uppercase tracking-widest text-[#6d5b26]">
                      {group.label}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {group.names.map((name) => (
                        <span
                          key={name}
                          className="border border-[#14211c]/45 bg-[#f2f0dc]/80 px-1.5 py-0.5 font-mono text-[10px]"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
          {preview.warnings.length > 0 && (
            <div className="bg-[#d9a441]/25 p-4">
              <p className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                <AlertTriangle className="size-3" /> Honest limits
              </p>
              {preview.warnings.map((warning) => (
                <p key={warning} className="text-xs">
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PlanSvg({ preview }: { preview: FamilyModelPreview }) {
  const extents = preview.solids.flatMap((solid) => [
    solid.width ?? solid.diameter ?? 1,
    solid.depth ?? solid.diameter ?? 1,
  ]);
  const max = Math.max(1, ...extents);
  const scale = 250 / max;
  return (
    <svg
      viewBox="0 0 320 320"
      role="img"
      aria-label={`Plan preview of ${preview.model.family.name}`}
      className="mx-auto aspect-square max-h-[470px] w-full"
    >
      <path d="M160 20V300M20 160H300" stroke="#587361" strokeWidth="1" strokeDasharray="5 5" />
      {preview.solids.map((solid) => {
        const diameter = (solid.diameter ?? 0) * scale;
        const width = (solid.width ?? solid.diameter ?? 1) * scale;
        const depth = (solid.depth ?? solid.diameter ?? 1) * scale;
        const voided = solid.kind.startsWith("Void");
        return solid.kind.includes("Cylinder") ? (
          <circle
            key={solid.name}
            cx="160"
            cy="160"
            r={diameter / 2}
            fill={voided ? "#e7e5cf" : "#9dc88d55"}
            stroke="#14211c"
            strokeWidth="2"
            strokeDasharray={voided ? "7 5" : undefined}
          >
            <title>{solid.name}</title>
          </circle>
        ) : (
          <rect
            key={solid.name}
            x={160 - width / 2}
            y={160 - depth / 2}
            width={width}
            height={depth}
            fill={voided ? "#e7e5cf" : "#9dc88d55"}
            stroke="#14211c"
            strokeWidth="2"
            strokeDasharray={voided ? "7 5" : undefined}
          >
            <title>{solid.name}</title>
          </rect>
        );
      })}
      {preview.solids.length === 0 && (
        <text
          x="160"
          y="154"
          textAnchor="middle"
          fontFamily="monospace"
          fontSize="11"
          fill="#596b5f"
        >
          NO DIRECT SOLIDS
        </text>
      )}
      {preview.solids.length === 0 && (
        <text
          x="160"
          y="172"
          textAnchor="middle"
          fontFamily="monospace"
          fontSize="10"
          fill="#6d5b26"
        >
          SEE CONSTITUENT REGISTER
        </text>
      )}
    </svg>
  );
}
