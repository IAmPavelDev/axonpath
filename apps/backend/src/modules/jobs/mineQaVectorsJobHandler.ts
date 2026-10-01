import type {
  MineQaVectors,
  QaBlockVectorsJobPayload,
} from "@/modules/memory/application/mine-qa-vectors";

/**
 * The instant trigger for QA-block memory mining. The miner owns its degrade
 * policy internally — every failure path (dedup read, block load, embeddings,
 * record) resolves to ok with nothing recorded — so there is deliberately no
 * error logging here; a silent no-op IS the correct outcome.
 */
export const getMineQaVectorsJobHandler = (mineQaVectors: MineQaVectors) => {
  return async (payload: QaBlockVectorsJobPayload) => {
    await mineQaVectors(payload);
  };
};
