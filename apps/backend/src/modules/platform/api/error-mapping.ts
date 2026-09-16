import { ORPCError } from "@orpc/server";
import { isTaggedError } from "@/modules/platform/errors";

export type MappedORPCError = ORPCError<
  "NOT_FOUND" | "INTERNAL",
  Record<string, unknown>
>;

/**
 * Maps domain failures to the oRPC wire. Tagged `*NotFound` errors become 404;
 * anything else (including untyped thrown errors) becomes a generic 500 so
 * internals never leak to the client.
 */
export const toORPCError = (error: unknown): MappedORPCError => {
  if (isTaggedError(error) && error.kind.endsWith("NotFound")) {
    return new ORPCError("NOT_FOUND", {
      data: { kind: error.kind },
    }) as unknown as MappedORPCError;
  }

  if (error instanceof ORPCError) {
    return error as unknown as MappedORPCError;
  }

  return new ORPCError("INTERNAL", {
    message: "Internal server error",
  }) as unknown as MappedORPCError;
};
