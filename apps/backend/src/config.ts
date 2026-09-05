// /home/iampaul/Projects/axonpath/be/src/config.ts
export const config = {
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  },
  skillLambdaDecayDefault: process.env.LAMBDA_DECAY_DEFAULT
    ? Number(process.env.LAMBDA_DECAY_DEFAULT)
    : 0.02,
  ai: {
    AI_API_KEY: process.env.GEMINI_API_KEY,
    models: {
      weak: 'gemini-2.0-flash-lite',
      pro: 'gemini-2.5-pro',
      embedding: 'gemini-embedding-001'
    }
  }
};