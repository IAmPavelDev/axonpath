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

const {
  CreateSkillInput,
  GetSkillListOutput,
  StatusOnly,
  SkillIdInput,
  GetSkillByIdOutput,
} = schema.skill;

export const editSkillHandler: OrpcHandler<
  z.infer<typeof schema.skill.EditSkillInput>,
  z.infer<typeof StatusOnly>
> = async ({ input, context }) => SkillService.update(input);

export const getSkillByIdHandler: OrpcHandler<
  z.infer<typeof SkillIdInput>,
  z.infer<typeof GetSkillByIdOutput>
> = async ({ input, context }) => {
  const skill = await SkillService.getSkillById(input);

  if (!skill) {
    throw new Error("Skill not found");
  }

  return skill;
};

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
    const skillInitDescription = await AiService.generateSkillDescription(
      input.topic,
    );

    if (skillInitDescription) {
      await SkillService.update({
        id: skill.id,
        description: skillInitDescription.description,
      });
    }

    const skillInitData = await AiService.generateInitSkill({
      userId,
      skillId: skill.id,
      topic: input.topic,
    });
    if (!skillInitData) {
      throw new Error("Failed to generate init skill");
    }

    const classData = await ClassService.createClass({
      skillId: skill.id,
      index: 0,
      title: skillInitData.classTitle,
      contentMd: skillInitData.classContentMd,
      aiModel: skillInitData.model,
    });

    for (const question of skillInitData.questions) {
      await QuestionService.createQuestion({
        skillId: skill.id,
        classId: classData.classId,
        type: question.type,
        text: question.text,
        choices: question.choices,
        answerKey: question.answerKey,
        aiModel: skillInitData.model,
      });
    }

    const embeddings = await AiService.generateEmbeddings(
      skillInitData.contextSnippets,
    );
    for (let i = 0; i < embeddings.length; i++) {
      await VectorService.createVectors({
        vectors: [
          {
            skillId: skill.id,
            userId,
            classId: classData.classId,
            embedding: embeddings[i],
            source: VectorSource.AI_INITIAL,
            textSnippet: skillInitData.contextSnippets[i],
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
