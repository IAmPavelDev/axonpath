import { ContextType } from "@/types/Context";

export type OrpcHandler<TInput, TOutput> = ({
  input,
  context,
}: {
  input: TInput;
  context: ContextType;
}) => Promise<TOutput> | TOutput;
