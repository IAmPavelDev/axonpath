export const config = {
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  },
  skillLambdaDecayDefault: process.env.LAMBDA_DECAY_DEFAULT
    ? Number(process.env.LAMBDA_DECAY_DEFAULT)
    : 0.02,
  ai: {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    models: {
      chat: 'deepseek/deepseek-v4.1-flash',
      embedding: 'google/gemini-embedding-001'
    }
  }
};

export type AiModelsType = typeof config.ai.models;
export type AiModelType = typeof config.ai.models[keyof typeof config.ai.models];
