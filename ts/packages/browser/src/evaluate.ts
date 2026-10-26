import { Script } from "node:vm";
import type { Protocol } from "devtools-protocol";
import type { CdpClient } from "./cdp.ts";
import { BrowserError } from "./errors.ts";

// A mapped shape accepts named DTO interfaces without requiring an index signature.
type JsonData<T> = T extends null | boolean | number | string
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends object
      ? { [K in keyof T]: JsonData<T[K]> }
      : never;

export interface Evaluation {
  /** Self-contained browser callback. Pass Node values explicitly as JSON arguments. */
  evaluate<Args extends unknown[], Result>(
    callback: (
      ...args: Args
    ) => Result & (Awaited<Result> extends JsonData<Awaited<Result>> ? unknown : never),
    ...args: Args & JsonData<Args>
  ): Promise<Awaited<Result>>;
}

/** Runs unchanged in Node and Chrome. Descriptors avoid getters and toJSON hooks. */
function jsonData(value: unknown, path = "$", ancestors = new Set<object>()): unknown {
  const invalid = (reason: string, at = path): never => {
    throw Object.assign(new Error(`${at}: ${reason}`), { path: at });
  };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : invalid("Expected a finite number");
  if (typeof value !== "object") return invalid(`Unsupported JSON value ${typeof value}`);
  if (ancestors.has(value)) return invalid("Cyclic JSON data");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    return invalid("Expected a plain object or array");
  ancestors.add(value);
  try {
    const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === "length") continue;
      if (typeof key !== "string") return invalid("Symbol properties are not JSON data");
      const at = `${path}[${JSON.stringify(key)}]`;
      const descriptor = descriptors[key];
      if (!("value" in descriptor)) return invalid("Accessors are not JSON data", at);
      if (!descriptor.enumerable) return invalid("Non-enumerable properties are not JSON data", at);
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
        return invalid("Extra array properties are not JSON data", at);
      Object.defineProperty(output, key, {
        value: jsonData(descriptor.value, at, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    if (array && Object.keys(output).length !== value.length)
      return invalid("Sparse arrays are not JSON data");
    return output;
  } finally {
    ancestors.delete(value);
  }
}

/** Each adapter supplies its own transport, including the guardian's forwarded transport. */
export function evaluator(sendRaw: CdpClient["sendRaw"]): Evaluation["evaluate"] {
  return (async (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => {
    let source: string;
    let argumentsJson: string;
    let phase = "callback";
    try {
      source = Function.prototype.toString.call(callback);
      if (/\{\s*\[native code\]\s*\}$/.test(source))
        throw new Error("Native and bound callbacks cannot be serialized");
      // Parse only; never invoke the callback in Node. This does not detect captured variables.
      new Script(`(${source})`);
      phase = "arguments";
      argumentsJson = JSON.stringify(jsonData(args));
    } catch (cause) {
      throw new BrowserError(
        "SerializationError",
        `Cannot serialize evaluation ${phase}: ${cause instanceof Error ? cause.message : String(cause)}. Use a self-contained function and plain JSON arguments.`,
        {
          method: "Runtime.evaluate",
          outcome: "not-sent",
          data: { phase, path: (cause as { path?: string })?.path ?? "$" },
          cause,
        },
      );
    }
    // Validation must happen in Chrome before returnByValue drops unsupported properties.
    const response = (await sendRaw("Runtime.evaluate", {
      expression: `(async () => { const value = await (${source})(...JSON.parse(${JSON.stringify(argumentsJson)})); try { return {ok:true,value:(${jsonData.toString()})(value)}; } catch (error) { return {ok:false,message:error.message,path:error.path}; } })()`,
      returnByValue: true,
      awaitPromise: true,
    })) as Protocol.Runtime.EvaluateResponse;
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails;
      const description =
        detail.exception?.description ??
        (detail.exception && "value" in detail.exception
          ? String(detail.exception.value)
          : detail.text);
      throw new BrowserError(
        "EvaluationError",
        `Browser callback failed: ${description}. Callbacks cannot capture Node variables; pass values explicitly as arguments.`,
        {
          method: "Runtime.evaluate",
          outcome: "unknown",
          data: { phase: "callback", path: "$", exceptionDetails: detail },
        },
      );
    }
    const result = response.result.value as {
      ok: boolean;
      value?: unknown;
      message?: string;
      path?: string;
    };
    if (!result || result.ok !== true) {
      throw new BrowserError(
        "SerializationError",
        `Browser callback result is not JSON data: ${result?.message ?? "Missing evaluation result"}`,
        {
          method: "Runtime.evaluate",
          outcome: "unknown",
          data: { phase: "result", path: result?.path ?? "$" },
        },
      );
    }
    return result.value;
  }) as Evaluation["evaluate"];
}
