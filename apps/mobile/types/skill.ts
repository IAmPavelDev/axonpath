import rpc from "@/utils/rpc";

export type Skill = Awaited<ReturnType<typeof rpc.skill.list>>[0];