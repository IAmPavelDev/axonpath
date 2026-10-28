import type { ContextType } from "@/modules/platform/context";

/**
 * Transport-agnostic API handler: validated input + authenticated context in,
 * output (validated against the route's response schema) out. Replaces the
 * previous ({input, context}) object-arg handler shape after the
 * migration — the Fastify route adapter calls handlers with positional args.
 */
export type ApiHandler<TInput, TOutput> = (
  input: TInput,
  context: ContextType,
) => Promise<TOutput> | TOutput;
