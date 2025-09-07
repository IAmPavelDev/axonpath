import { AnswerItem } from "./AnswerItem.ts";

export interface SubmitAnswersRequest {
  Params: { id: string };
  Body: {
    items: AnswerItem[];
    requestId?: string;
  };
}
