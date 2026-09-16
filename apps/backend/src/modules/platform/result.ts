/**
 * Explicit result type for domain-expectable failures.
 *
 * Deliberately mirrors Effect's `Either` shape so the future Effect-TS
 * migration is mechanical: `Result<T, E>` -> `Effect<T, E>` per use case,
 * `unwrapOrThrow` disappears into `Effect.flip`/`Effect.catchAll`.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Type guard: narrows to the failure branch. */
export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } =>
  !result.ok;

/** Extract the success value, or throw a mapped error (interface-layer escape hatch). */
export const unwrapOrThrow = <T, E>(
  result: Result<T, E>,
  mapError: (error: E) => unknown = (e) => e,
): T => {
  if (result.ok) return result.value;
  throw mapError(result.error);
};
