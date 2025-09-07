import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { OpenSearchServerlessClient, CreateCollectionCommand } from '@aws-sdk/client-opensearchserverless';
import { config } from '@config';

const DEFAULT_LAMBDA = config.skillLambdaDecayDefault ?? 0.02;
const DEFAULT_K = 10;
const VECTOR_SOURCE_TYPES = ['ai-initial', 'ai-next', 'answer-derived'] as const;
type VectorSource = typeof VECTOR_SOURCE_TYPES[number];

interface SkillVector {
  id: string;
  vector: number[];
  text: string;
  source: VectorSource;
  classIndex?: number;
  tokenCount?: number;
}

interface QueryOptions {
  k?: number;
  lambda?: number;
}

export class VectorService {
  private awsClient: OpenSearchServerlessClient;
  private searchClient: Client;

  constructor() {
    this.awsClient = new OpenSearchServerlessClient({
      region: config.aws.region,
    });

    this.searchClient = new Client({
      ...AwsSigv4Signer({
        region: config.aws.region,
        service: 'aoss',
      }),
      node: config.vectorDb.endpoint,
    });
  }

  /**
   * Creates the collection and vector index for a given skill.
   * - If already exists, does not fail (idempotent).
   */
  async createSkillCollection(skillId: string, dimension: number): Promise<void> {
    const collectionName = `skill-${skillId}`;
    // Create collection if not exists
    try {
      await this.awsClient.send(new CreateCollectionCommand({
        name: collectionName,
        type: 'VECTORSEARCH',
      }));
    } catch (err: any) {
      // Idempotency: If already exists, ignore
      if (!(err?.name === 'ConflictException' || err?.message?.includes('already exists'))) {
        throw new Error(`Failed to create OpenSearch collection: ${err.message ?? err}`);
      }
    }

    // Create index with KNN vector config if not exists
    const indexExists = await this.searchClient.indices.exists({ index: collectionName });
    if (!indexExists.body) {
      await this.searchClient.indices.create({
        index: collectionName,
        body: {
          settings: {
            index: {
              knn: true,
              "knn.space_type": 'cosinesimil'
            }
          },
          mappings: {
            properties: {
              vector: {
                type: 'knn_vector',
                dimension,
                method: {
                  name: 'hnsw',
                  space_type: 'cosinesimil',
                  engine: 'faiss'
                }
              },
              skill_id: { type: 'keyword' },
              source: { type: 'keyword' },
              text_snippet: { type: 'text' },
              class_index: { type: 'integer' },
              created_at: { type: 'date' },
              token_count: { type: 'integer' }
            }
          }
        }
      });
    }
  }

  /**
   * Bulk upserts an array of vectors for the skill. Idempotent at the document _id layer.
   */
  async upsertVectors(skillId: string, vectors: SkillVector[]): Promise<void> {
    const collectionName = `skill-${skillId}`;
    if (!vectors.length) return;

    const now = Date.now();
    const body = vectors.flatMap(vector => [
      { index: { _index: collectionName, _id: vector.id } },
      {
        vector: vector.vector,
        skill_id: skillId,
        source: vector.source,
        text_snippet: vector.text,
        class_index: vector.classIndex ?? null,
        created_at: now,
        token_count: vector.tokenCount ?? null
      }
    ]);
    try {
      const resp = await this.searchClient.bulk({ refresh: true, body });
      if (resp.body.errors) {
        throw new Error(`Bulk vector upsert reported errors: ${JSON.stringify(resp.body.errors)}`);
      }
    } catch (err: any) {
      throw new Error(`Failed to bulk upsert vectors: ${err.message ?? err}`);
    }
  }

  /**
   * Queries k nearest context vectors with recency-decayed score.
   */
  async queryVectors(
    skillId: string,
    queryVector: number[],
    options: QueryOptions = {}
  ): Promise<{ id: string; score: number; text: string; source: string; classIndex?: number; ageDays: number }[]> {
    const collectionName = `skill-${skillId}`;
    const k = options.k ?? DEFAULT_K;
    const lambda = options.lambda ?? DEFAULT_LAMBDA;
    const queryTime = Date.now();

    try {
      const response = await this.searchClient.search({
        index: collectionName,
        body: {
          size: k,
          query: {
            script_score: {
              query: { match_all: {} },
              script: {
                // Pass all JS time params in ms for consistency with OpenSearch date fields
                source: `
                  double similarity = (cosineSimilarity(params.query_vector, 'vector') + 1.0) / 2.0;
                  double ageInDays = (params.now - doc['created_at'].value.toInstant().toEpochMilli()) / 8.64e7;
                  return similarity * Math.exp(-params.lambda * ageInDays);
                `,
                params: {
                  query_vector: queryVector,
                  lambda,
                  now: queryTime
                }
              }
            }
          },
          _source: ['text_snippet', 'source', 'class_index', 'created_at']
        }
      });

      return (response.body.hits.hits as any[]).map(hit => ({
        id: hit._id,
        score: hit._score,
        text: hit._source.text_snippet,
        source: hit._source.source,
        classIndex: hit._source.class_index,
        ageDays: (queryTime - new Date(hit._source.created_at).getTime()) / 8.64e7
      }));
    } catch (err: any) {
      throw new Error(`Failed to query vectors: ${err.message ?? err}`);
    }
  }

  /**
   * Deletes a skill's vector index and optionally the collection (idempotent).
   */
  async deleteSkillCollection(skillId: string): Promise<void> {
    const collectionName = `skill-${skillId}`;
    try {
      await this.searchClient.indices.delete({ index: collectionName });
    } catch (err: any) {
      // If not found, ignore
      if (!(err?.meta?.body?.error?.type === 'index_not_found_exception')) {
        throw new Error(`Vector index delete failed: ${err.message ?? err}`);
      }
    }
    // Optionally, also delete the Serverless collection via this.awsClient if requirements specify.
  }
}