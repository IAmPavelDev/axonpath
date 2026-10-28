import { isTaggedError } from "@/modules/platform/errors";

export type HttpError = {
  status: number;
  body: { code: string; message: string };
};

export const isHttpError = (value: unknown): value is HttpError =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  "body" in value &&
  typeof (value as HttpError).body?.code === "string";

/**
 * Maps domain failures to the REST wire (migration D6): flat
 * `{"code", "message"}` body + real HTTP status. Tagged `*NotFound` and
 * `NotOwned` errors become 404; `InvalidSkillTransition`/`*NotAllowed`
 * become 409; anything else (including untyped thrown errors) becomes a
 * generic 500 so internals never leak to the client. Statuses follow the
 * previous transport's status map baseline for wire continuity.
 */
export const toHttpError = (error: unknown): HttpError => {
  if (isTaggedError(error)) {
    // NotOwned hides behind 404 so skill existence is not leaked.
    if (error.kind.endsWith("NotFound") || error.kind === "NotOwned") {
      return { status: 404, body: { code: "NOT_FOUND", message: error.detail ?? error.kind } };
    }
    if (error.kind === "InvalidSkillTransition" || error.kind.endsWith("NotAllowed")) {
      return { status: 409, body: { code: "CONFLICT", message: error.detail ?? error.kind } };
    }
  }

  if (isHttpError(error)) {
    return error;
  }

  return {
    status: 500,
    body: { code: "INTERNAL_SERVER_ERROR", message: "Internal server error" },
  };
};
