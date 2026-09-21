import { ORPCError } from "@orpc/server";
import { isTaggedError } from "@/modules/platform/errors";

export type MappedORPCError = ORPCError<
  "NOT_FOUND" | "CONFLICT" | "INTERNAL",
  Record<string, unknown>
>;

/**
 * Maps domain failures to the oRPC wire. Tagged `*NotFound` and `NotOwned`
 * errors become 404; `InvalidSkillTransition` becomes 409; anything else
 * (including untyped thrown errors) becomes a generic 500 so internals never
 * leak to the client.
 */
export const toORPCError = (error: unknown): MappedORPCError => {
  if (isTaggedError(error)) {
    // NotOwned hides behind 404 so skill existence is not leaked.
    if (error.kind.endsWith("NotFound") || error.kind === "NotOwned") {
      return new ORPCError("NOT_FOUND", {
        data: { kind: error.kind },
      }) as unknown as MappedORPCError;
    }
    if (error.kind === "InvalidSkillTransition") {
      return new ORPCError("CONFLICT", {
        data: { kind: error.kind },
      }) as unknown as MappedORPCError;
    }
  }

  if (error instanceof ORPCError) {
    return error as unknown as MappedORPCError;
  }

  return new ORPCError("INTERNAL", {
    message: "Internal server error",
  }) as unknown as MappedORPCError;
};
