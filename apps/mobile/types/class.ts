import rpc from "@/utils/rpc";

export type Class = Awaited<ReturnType<typeof rpc.class.list>>[0];