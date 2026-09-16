import type { ContextType } from "@/modules/platform/context";

export type OrpcHandler<TInput, TOutput> = ({
  input,
  context,
}: {
  input: TInput;
  context: ContextType;
}) => Promise<TOutput> | TOutput;
