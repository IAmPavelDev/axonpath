import { prisma } from "@/prisma";
import { CreateVectorInputDto, CreateVectorOutputDto, CreateVectorsInputDto } from "./dto/CreateVector.dto";
import { Prisma } from "@/prisma/generated/client";

const createVector = async (input: CreateVectorInputDto): Promise<CreateVectorOutputDto> => {
  const embeddingString = JSON.stringify(input.embedding);

  const result = await prisma.$queryRaw<[{ id: number }]>`
    INSERT INTO "Vector" (
      "skillId",
      "embedding",
      "source",
      "textSnippet",
      "classIndex",
      "tokenCount"
    ) VALUES (
      ${input.skillId},
      ${embeddingString}::vector,
      ${input.source}::"VectorSource",
      ${input.textSnippet},
      ${input.classIndex},
      ${input.tokenCount}
    )
    RETURNING id;
  `;

  const vectorId = result[0].id;

  return { vectorId };
};

/**
 * Performs a bulk insert of multiple vectors into the database.
 * @param input An object containing an array of vectors to create.
 */
const createVectors = async (input: CreateVectorsInputDto): Promise<void> => {
  if (input.vectors.length === 0) {
    return;
  }

  const valueTuples = input.vectors.map(vector => {
    const embeddingString = JSON.stringify(vector.embedding);
    return Prisma.sql`(
      ${vector.skillId},
      ${vector.classId},
      ${embeddingString}::vector,
      ${vector.source}::"VectorSource",
      ${vector.textSnippet},
      ${vector.classIndex},
      ${vector.tokenCount}
    )`;
  });

  const values = Prisma.join(valueTuples);

  await prisma.$executeRaw`
    INSERT INTO "Vector" (
      "skillId",
      "classId",
      "embedding",
      "source",
      "textSnippet",
      "classIndex",
      "tokenCount"
    ) VALUES ${values};
  `;
};

export default { createVector, createVectors };