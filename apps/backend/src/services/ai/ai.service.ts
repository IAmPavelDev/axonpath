import { GoogleGenAI } from "@google/genai";
import { prisma } from '@/prisma/index.ts';
import { config } from '@/config.ts';
import { EventType } from "@/prisma/generated/index.ts";

const models = {
  weak: 'gemini-2.0-flash-lite',
  pro: 'gemini-2.5-pro',
};

type InitSkillResponse = {
  classContentMd: string;
  questions: string[];
  contextSnippets: string[];
};

type NextClassResponse = {
  classContentMd: string;
  questions: string[];
  newContextSnippets: string[];
};

type ContentGenerationResponse = {
  response: string;
  model: typeof models[keyof typeof models];
};

const genAI = new GoogleGenAI({
  apiKey: config.ai.AI_API_KEY
});

// const weakGeneration = async (contents: string): Promise<ContentGenerationResponse> => {
//   try {
//     const response = await genAI.models.generateContent({
//       model: models.weak,
//       contents,
//     });
  
//     return {
//       response: response.text ?? '',
//       model: models.weak,
//     };
//   } catch (error) {
//     console.error('AI generation failed:', error);

//     return {
//       response: '',
//       model: models.weak,
//     };;
//   }
// };

const performantGeneration = async (contents: string): Promise<ContentGenerationResponse> => {
  try {
    const response = await genAI.models.generateContent({
      model: models.pro,
      contents,
    });
  
    return {
      response: response.text ?? '',
      model: models.pro,
    };
  } catch (error) {
    console.error('AI generation failed:', error);
  }
  
  return {
    response: '',
    model: models.pro,
  };
};

const generateInitSkill = async (
  params: InitSkillParams,
): Promise<InitSkillResponse | undefined> => {
  const prompt = `Generate initial learning content for topic: ${params.topic}. Include:
      - Detailed markdown lesson (500-700 words)
      - 5-10 key context snippets (bullet points)
      - 5-10 multiple choice questions with answers

      Format as JSON: { "classContentMd": "...", "questions": ["..."], "contextSnippets": ["..."] }`;

  try {
    const { response, model } = await performantGeneration(prompt);

    // Log to audit events
    const cleanedText = response.replace(/```json/g, '').replace(/```/g, '');
    const responseData = JSON.parse(cleanedText);

    await prisma.event.create({
      data: {
        type: EventType.SKILL_CREATED,
        skillId: params.skillId,
        payload: {
          action: 'init_skill',
          prompt: prompt.substring(0, 2000),
          model,
          response: cleanedText,
        },
      },
    });

    return responseData;
  } catch (error) {
    console.error('AI generation failed:', error);
  }
};

const generateNextClass = async (
  params: NextClassParams,
): Promise<NextClassResponse> => {
  const prompt = `Generate next class based on:
      - Previous context: ${params.selectedContext.join('\n')}
      - User answers: ${JSON.stringify(params.answers)}

      Produce:
      - Continuation lesson in markdown
      - 5-10 new context snippets
      - 5-10 new questions

      Format as JSON: { "classContentMd": "...", "questions": ["..."], "newContextSnippets": ["..."] }`;

  try {
    const { response, model } = await performantGeneration(prompt);

    const cleanedText = response.replace(/```json/g, '').replace(/```/g, '');

    await prisma.event.create({
      data: {
        type: EventType.CLASS_GENERATED,
        skillId: params.skillId,
        payload: {
          prompt,
          response: cleanedText,
          model,
        },
      },
    });

    return JSON.parse(cleanedText);
  } catch (error: unknown) {
    console.error('Next class generation failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`AI service error: ${message}`);
  }
};

export interface InitSkillParams {
  skillId: string;
  topic: string;
}

export interface NextClassParams {
  skillId: string;
  skillTopic: string;
  lastClassIdx: number;
  answers: string[];
  selectedContext: string[];
}
