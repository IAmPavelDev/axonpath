export type OrpcHandler<TInput, TOutput> = (
    { input, context }: { input: TInput, context: any }
  ) => Promise<TOutput> | TOutput;
  