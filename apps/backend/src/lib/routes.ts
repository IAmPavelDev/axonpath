import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { ROUTES, type RouteDef } from "@axon/api-contract";
import type { ApiHandler } from "@/modules/platform/api/handler";
import { toHttpError } from "@/modules/platform/api/error-mapping";
import type { AuthHookDeps } from "@/lib/auth-hook";
import { makeAuthHook } from "@/lib/auth-hook";

/** Handler registry keyed by the route table's operationId. */
export type ApiHandlers = Record<string, ApiHandler<never, unknown>>;

const shapeOf = (schema: z.ZodType): Record<string, z.ZodType> =>
  (schema as z.ZodObject).shape as Record<string, z.ZodType>;


// Fastify hands path/query values over as strings; the input schemas expect
// numbers and booleans. The previous transport bridged this with a
// transport now owns it (migration P0.2 fallback). Schema-informed via a
// safeParse probe: a coerced candidate is used only when the field's schema
// actually accepts it, so string-typed fields that merely look numeric
// (e.g. 11-char YouTube ids) pass through untouched. The merged input parse
// re-validates the coerced value against every constraint.
const coerceWireValue = (field: z.ZodType, value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && field.safeParse(asNumber).success) {
    return asNumber;
  }
  if (value === "true" && field.safeParse(true).success) return true;
  if (value === "false" && field.safeParse(false).success) return false;
  return value;
};

/**
 * One merged input schema per route: path params + query params + body
 * fields, with wire coercion preprocessing on params/query. Field names are
 * disjoint across the three sources (the route table guarantees it), so the
 * parsed input has exactly the shape the handlers received before the swap.
 */
const inputSchemaFor = (route: RouteDef): z.ZodType | undefined => {
  if (!route.params && !route.query && !route.body) return undefined;
  const fields: Record<string, z.ZodType> = {};
  for (const source of [route.params, route.query]) {
    if (!source) continue;
    for (const [name, field] of Object.entries(shapeOf(source))) {
      fields[name] = z.preprocess(
        (value) => coerceWireValue(field, value),
        field,
      );
    }
  }
  if (route.body) {
    Object.assign(fields, shapeOf(route.body));
  }
  return z.object(fields);
};

const VALIDATION_STATUS = 422;

/**
 * Registers all 24 API routes on Fastify FROM the contract route table
 * (migration D3). Each route gets the auth hook (preValidation — auth runs
 * before input validation, matching the previous middleware order), zod input
 * parsing with wire coercion, and D6 error mapping. Success replies carry
 * the bare output object — the previous `{"json": …}` envelope disappears.
 */
export const registerApiRoutes = (
  app: FastifyInstance,
  handlers: ApiHandlers,
  auth: AuthHookDeps,
): void => {
  const authHook = makeAuthHook(auth);

  for (const route of ROUTES) {
    const handler = handlers[route.id];
    if (!handler) {
      throw new Error(`No handler registered for route ${route.id}`);
    }
    const inputSchema = inputSchemaFor(route);
    const url = route.path.replace(/\{(\w+)\}/g, ":$1");

    app.route({
      method: route.method,
      url,
      preValidation: authHook,
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const rawInput = {
            ...(request.params as Record<string, unknown>),
            ...(request.query as Record<string, unknown>),
            ...((request.body ?? {}) as Record<string, unknown>),
          };
          const input = inputSchema
            ? inputSchema.parse(rawInput)
            : rawInput;
          const output = await handler(input as never, {
            user: request.user,
          });
          // Validate the response against the contract schema — same
          // output-parsing guarantee the api layer has always had.
          const parsed = route.response.parse(output);
          return reply.status(200).send(parsed);
        } catch (error) {
          if (error instanceof ZodError) {
            const issue = error.issues[0];
            const where = issue.path.join(".");
            return reply.status(VALIDATION_STATUS).send({
              code: "VALIDATION",
              message: where
                ? `${where}: ${issue.message}`
                : issue.message,
            });
          }
          const mapped = toHttpError(error);
          return reply.status(mapped.status).send(mapped.body);
        }
      },
    });
  }
};
