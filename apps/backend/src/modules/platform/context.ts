import type { User } from "@/prisma/generated";

export type ContextType = {
  user: User;
};
