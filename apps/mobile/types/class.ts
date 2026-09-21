import rpc from "@/utils/rpc";

export type Class = Awaited<ReturnType<typeof rpc.class.list>>[0];

/** class.get response; skillId arrives with the adaptive-loop contract. */
export interface ClassById {
  id: number;
  skillId: number;
  title: string;
  contentMd: string;
}