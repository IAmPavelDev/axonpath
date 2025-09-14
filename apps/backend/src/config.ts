// /home/iampaul/Projects/axonpath/be/src/config.ts
export const config = {
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
  },
  vectorDb: {
    endpoint: process.env.VECTOR_DB_URL || 'https://your-opensearch-endpoint',
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