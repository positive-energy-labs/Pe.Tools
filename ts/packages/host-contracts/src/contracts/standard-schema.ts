import { Effect, Schema, SchemaIssue } from "effect";

type StandardIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
};

/** The Standard Schema v1 surface zod 4 implements; only the synchronous `validate` is read. */
export type StandardSchema<T> = {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly value: T; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<StandardIssue> }
      | Promise<unknown>;
  };
};

/**
 * An Effect Schema over a contract-kernel validator (ADR 0029 rules 7 and 8): the edge decodes with
 * Effect while the zod contract stays the type until the schema wave moves it. Each standard issue
 * lands as a `Pointer` at its path, so a failure names its field as a native decode does. The
 * decoded value is the validator's output (zod defaults and transforms applied).
 */
export const fromStandardSchema = <T>(standard: StandardSchema<T>, identifier: string) =>
  Schema.declareConstructor<T, unknown>()(
    [],
    () => (input, ast, options) => {
      const result = standard["~standard"].validate(input);
      if (result instanceof Promise)
        return Effect.die(new Error(`${identifier}: an async validator cannot decode an edge`));
      if (!result.issues) return Effect.succeed(result.value);
      const issues = result.issues.map(
        (issue): SchemaIssue.Issue =>
          new SchemaIssue.Pointer(
            (issue.path ?? []).map((key) => (typeof key === "object" ? key.key : key)),
            new SchemaIssue.InvalidValue({ message: issue.message }),
          ),
      );
      return Effect.fail(
        new SchemaIssue.Composite(
          ast,
          issues as [SchemaIssue.Issue, ...SchemaIssue.Issue[]],
          input,
          options,
        ),
      );
    },
    { identifier },
  );
