import type {
  MineAnswerVectors,
  SkillAnswerVectorsJobPayload,
} from "@/modules/memory/application/mine-answer-vectors";

/**
 * The instant trigger for answer-memory mining. The miner owns its degrade
 * policy internally — every failure path (dedup read, embeddings, record)
 * resolves to ok with nothing recorded — so there is deliberately no error
 * logging here; a silent no-op IS the correct outcome.
 */
export const getMineAnswerVectorsJobHandler = (
  mineAnswerVectors: MineAnswerVectors,
) => {
  return async (payload: SkillAnswerVectorsJobPayload) => {
    await mineAnswerVectors(payload);
  };
};
