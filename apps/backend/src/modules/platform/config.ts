export const config = {
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  },
  skillLambdaDecayDefault: process.env.LAMBDA_DECAY_DEFAULT
    ? Number(process.env.LAMBDA_DECAY_DEFAULT)
    : 0.02,
  ai: {
    ZAI_API_KEY: process.env.ZAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    chatBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
    embeddingBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    models: {
      chat: 'glm-5.3-flash',
      embedding: 'gemini-embedding-2',
    },
  },
};

export type AiModelsType = typeof config.ai.models;
export type AiModelType = typeof config.ai.models[keyof typeof config.ai.models];
