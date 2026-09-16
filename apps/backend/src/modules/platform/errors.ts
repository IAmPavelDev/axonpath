/**
 * Domain error convention: every domain error is a plain tagged object with a
 * `kind` discriminator string, unique per module, ending in "NotFound" for
 * missing-entity errors. Plain objects (not classes) so they are
 * structured-cloneable and map 1:1 onto Effect's `Data.TaggedError`.
 *
 * Example:
 *   export type SkillError = { kind: "SkillNotFound"; skillId: number };
 */
export interface TaggedError {
  kind: string;
  detail?: string;
}

export const isTaggedError = (value: unknown): value is TaggedError =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  typeof (value as { kind: unknown }).kind === "string";
