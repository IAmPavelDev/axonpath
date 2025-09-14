import { z } from "zod";
import SkillService from "@/services/skill/skill.service.ts";
import ClassService from "@/services/class/class.service.ts";
import QuestionService from "@/services/quiz/quiz.service.ts";
import VectorService from "@/services/vector/vector.service.ts";
import { OrpcHandler } from "@/types/OrpcHandler";
import AiService from "@/services/ai/ai.service.ts";
import { runDetached } from "@/helpers/runTaskDetached.ts";
import { VectorSource } from "@/prisma/generated/index.js";
import { schema } from "@axon/api-contract";

const { CreateSkillInput, GetSkillListOutput, StatusOnly, SkillIdInput } =
  schema.skill;

export const createSkillHandler: OrpcHandler<
  z.infer<typeof CreateSkillInput>,
  z.infer<typeof StatusOnly> & z.infer<typeof SkillIdInput>
> = async ({ input, context }) => {
  const { id: userId } = context.user;

  const skill = await SkillService.createSkill({
    topic: input.topic,
    userId,
  });

  runDetached(async () => {
    const response = await AiService.generateInitSkill({
      userId,
      skillId: skill.id,
      topic: input.topic,
    });
    if (!response) {
      throw new Error("Failed to generate init skill");
    }

    const classData = await ClassService.createClass({
      skillId: skill.id,
      index: 0,
      title: response.classTitle,
      contentMd: response.classContentMd,
      aiModel: response.model,
    });

    for (const question of response.questions) {
      await QuestionService.createQuestion({
        skillId: skill.id,
        classId: classData.classId,
        type: question.type,
        text: question.text,
        choices: question.choices,
        answerKey: question.answerKey,
        aiModel: response.model,
      });
    }

    const embeddings = await AiService.generateEmbeddings(
      response.contextSnippets
    );
    for (let i = 0; i < embeddings.length; i++) {
      await VectorService.createVectors({
        vectors: [
          {
            skillId: skill.id,
            classId: classData.classId,
            embedding: embeddings[i],
            source: VectorSource.AI_INITIAL,
            textSnippet: response.contextSnippets[i],
            classIndex: 0,
          },
        ],
      });
    }
  }, {});

  return skill;
};

export const getSkillListHandler: OrpcHandler<
  unknown,
  z.infer<typeof GetSkillListOutput>
> = async ({ context }) => {
  const { skills } = await SkillService.getSkillsList({
    userId: context.user.id,
  });

  return skills.map((skill) => ({
    id: skill.id,
    topic: skill.topic,
    status: skill.status,
    createdAt: skill.createdAt,
  }));
};
