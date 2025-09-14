import { config } from "@/config";

export type AiModelsType = typeof config.ai.models;
export type AiModelType = typeof config.ai.models[keyof typeof config.ai.models];