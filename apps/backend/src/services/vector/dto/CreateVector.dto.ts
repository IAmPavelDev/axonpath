import { VectorSource } from "@/prisma/generated";

export interface CreateVectorInputDto {
  skillId: number;
  userId: number;
  classId: number;
  embedding: number[];
  source: VectorSource;
  textSnippet: string;
  classIndex?: number;
  tokenCount?: number;
}

export interface CreateVectorsInputDto {
  vectors: CreateVectorInputDto[];
}