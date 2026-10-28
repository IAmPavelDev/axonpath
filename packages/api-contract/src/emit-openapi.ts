import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import z from "zod";
import { ROUTES, type RouteDef } from "./routes.js";

/**
 * Emits the committed OpenAPI 3.0.3 artifact (`openapi.json`) from ROUTES
 * (migration D3/D4). Zod v4's native JSON Schema converter targets
 * `openapi-3.0` directly; `z.date()` needs an explicit date-time override
 * (it is "unrepresentable" by default — P0 finding).
 */

const jsonify = (
  schema: z.ZodType,
  io: "input" | "output",
): Record<string, unknown> =>
  z.toJSONSchema(schema, {
    io,
    target: "openapi-3.0",
    unrepresentable: "any",
    override: (ctx) => {
      if (ctx.zodSchema instanceof z.ZodDate) {
        Object.assign(ctx.jsonSchema, { type: "string", format: "date-time" });
      }
    },
  }) as Record<string, unknown>;

const shapeOf = (
  schema: z.ZodType,
): Record<string, z.ZodType> =>
  (schema as z.ZodObject).shape as Record<string, z.ZodType>;

const operationFor = (route: RouteDef): Record<string, unknown> => {
  const parameters: Record<string, unknown>[] = [];

  if (route.params) {
    for (const [name, field] of Object.entries(shapeOf(route.params))) {
      parameters.push({
        name,
        in: "path",
        required: true,
        schema: jsonify(field, "input"),
      });
    }
  }
  if (route.query) {
    for (const [name, field] of Object.entries(shapeOf(route.query))) {
      const schema = jsonify(field, "input");
      // A query param is optional on the wire when the field tolerates
      // absence: `.optional()` or `.default(...)` both parse `undefined`.
      const required = !field.safeParse(undefined).success;
      parameters.push({
        name,
        in: "query",
        required,
        schema,
      });
    }
  }

  const operation: Record<string, unknown> = {
    operationId: route.id,
    summary: route.summary,
    tags: [route.tag],
    security: [{ bearerAuth: [] }],
    responses: {
      "200": {
        description: "Success",
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${route.id}Response` },
          },
        },
      },
      default: {
        description: "Error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
  };
  if (parameters.length > 0) {
    operation.parameters = parameters;
  }
  if (route.body) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${route.id}Request` },
        },
      },
    };
  }
  return operation;
};

const paths: Record<string, Record<string, unknown>> = {};
const schemas: Record<string, unknown> = {
  // Flat error body shared by every failure response (migration D6).
  ErrorResponse: {
    type: "object",
    required: ["code", "message"],
    properties: {
      code: {
        type: "string",
        description:
          "Machine-readable error code (vocabulary continuity: BAD_REQUEST, UNAUTHORIZED, NOT_FOUND, CONFLICT, VALIDATION, TOO_MANY_REQUESTS, INTERNAL_SERVER_ERROR, ...)",
      },
      message: { type: "string" },
    },
  },
};

for (const route of ROUTES) {
  (paths[route.path] ??= {})[route.method.toLowerCase()] = operationFor(route);
  schemas[`${route.id}Response`] = jsonify(route.response, "output");
  if (route.body) {
    schemas[`${route.id}Request`] = jsonify(route.body, "input");
  }
}

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Axon API",
    version: "1.0.0",
    description:
      "Generated from packages/api-contract zod schemas — do not edit by hand; change routes.ts and re-run the emitter.",
  },
  servers: [
    { url: "https://t3afkc5pj2.execute-api.eu-central-1.amazonaws.com" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Firebase ID token",
        description: "Firebase ID token issued at client sign-in.",
      },
    },
    schemas,
  },
  paths,
};

const body = JSON.stringify(spec, null, 2) + "\n";
// Package root: the committed, CI-drift-checked artifact (D4). dist/: the
// copy the backend serves at GET /spec.json (deploy ships contract dist).
writeFileSync(resolve(__dirname, "../openapi.json"), body);
writeFileSync(resolve(__dirname, "openapi.json"), body);
console.log(
  `openapi.json written: ${Object.keys(paths).length} paths, ${ROUTES.length} operations`,
);
