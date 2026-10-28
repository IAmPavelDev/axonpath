import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { ApiHandler } from "@/modules/platform/api/handler";

export const makeAuthHandlers = () => ({
  me: (async (_, context) => ({
    id: context.user.id,
    email: context.user.email,
    firstName: context.user.firstName,
    lastName: context.user.lastName,
    photoUrl: context.user.photoUrl,
    role: context.user.role,
    status: context.user.status,
    emailVerified: context.user.emailVerified,
    firebaseUid: context.user.firebaseUid,
  })) satisfies ApiHandler<
    unknown,
    z.infer<typeof schema.auth.MeOutput>
  >,
});
