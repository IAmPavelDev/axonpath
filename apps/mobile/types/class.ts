import rpc from "@/utils/rpc";

export type Class = Awaited<ReturnType<typeof rpc.class.list>>[0];
export type ClassById = Awaited<ReturnType<typeof rpc.class.get>>;