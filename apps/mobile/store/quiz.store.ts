import { ClassById } from '@/types/class';
import { Question } from '@/types/quiz';
import { create } from 'zustand';

type QuizStoreType = {
  questions: {
    [classId: ClassById['id']]: Question[];
  };
  answers: { questionId: Question['id']; answer: string | null }[];
  setQuestions: (classid: number, questions: Question[]) => void;
  setAnswer: (questionId: Question['id'], answer: string | null) => void;
};

export const useQuizStore = create<QuizStoreType>((set, get) => ({
  questions: [],
  answers: [],
  setQuestions: (classId: number, questions: Question[]) => {
    set((state) => ({
      questions: {
        ...state.questions,
        [classId]: questions,
      },
      answers: questions.map(({ id }) => ({ questionId: id, answer: null })),
    }));
  },
  setAnswer: (questionId: number, answer: string | null) => {
    set((state) => ({
      answers: state.answers.map((a) => (a.questionId === questionId ? { ...a, answer } : a)),
    }));
  },
}));
