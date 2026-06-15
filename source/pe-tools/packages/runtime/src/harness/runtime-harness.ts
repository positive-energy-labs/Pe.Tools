import { Harness } from "@mastra/core/harness";

export class RuntimeHarness<
  TState extends Record<string, unknown> = Record<string, unknown>,
> extends Harness<TState> {
  override async switchThread({ threadId }: { threadId: string }): Promise<void> {
    if (this.getCurrentThreadId() === threadId) return;
    await super.switchThread({ threadId });
  }
}
