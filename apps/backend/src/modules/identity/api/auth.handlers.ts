import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";

export const makeAuthHandlers = () => ({
  me: (async ({ context }) => ({
    id: context.user.id,
    email: context.user.email,
    firstName: context.user.firstName,
    lastName: context.user.lastName,
    photoUrl: context.user.photoUrl,
    role: context.user.role,
    status: context.user.status,
    emailVerified: context.user.emailVerified,
    firebaseUid: context.user.firebaseUid,
  })) satisfies OrpcHandler<
    unknown,
    z.infer<typeof schema.auth.MeOutput>
  >,
});
