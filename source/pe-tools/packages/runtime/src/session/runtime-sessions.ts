import type { Harness } from "@mastra/core/harness";
import {
  createRuntimeKernel,
  type RuntimeKernelContextProvider,
  type RuntimeKernelOptions,
} from "../kernel.ts";
import type { RuntimeContextEntry } from "../context.ts";
import type { RuntimeKernel, RuntimeSendMessageOptions, RuntimeSessions } from "../runtime.ts";

export type RuntimeSessionContextProvider = RuntimeKernelContextProvider;

export interface RuntimeSessionOptions extends RuntimeKernelOptions {
  kernel?: RuntimeKernel;
}

export function createRuntimeSessions(
  harness: Harness<Record<string, unknown>>,
  sessionOptions: RuntimeSessionOptions = {},
): RuntimeSessions {
  const kernel = sessionOptions.kernel ?? createRuntimeKernel(harness, sessionOptions);

  return {
    async createThreadSession(options) {
      return kernel.createThreadSession(options);
    },
    async switchThread(options) {
      await kernel.switchThread(options);
    },
    async listThreadSessions() {
      return kernel.listThreadSessions();
    },
    async readThreadMessages(options) {
      return kernel.readThreadMessages(options);
    },
    async readThreadLedger(options) {
      return kernel.readThreadLedger(options);
    },
    async deleteThreadSession(options) {
      await kernel.deleteThreadSession(options);
    },
    getResourceId() {
      return kernel.getResourceId();
    },
    recordUserPrompt(options: RuntimeSendMessageOptions) {
      return kernel.recordUserPrompt(options);
    },
    recordProtocolEvent(options) {
      return kernel.recordProtocolEvent(options);
    },
    snapshotLedger(options) {
      return kernel.snapshotLedger(options);
    },
    async sendMessage(options: RuntimeSendMessageOptions) {
      await kernel.sendMessage(options);
    },
    async queueMessage(options: RuntimeSendMessageOptions) {
      return kernel.queueMessage(options);
    },
    abort: kernel.abort.bind(kernel),
    subscribe(listener) {
      return kernel.subscribe(listener);
    },
  };
}

export type { RuntimeContextEntry };
