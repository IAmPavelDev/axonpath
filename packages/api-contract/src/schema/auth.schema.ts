import z from 'zod';

export const MeOutput = z.object({
  id: z.number().int(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  photoUrl: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  emailVerified: z.boolean(),
  firebaseUid: z.string().nullable(),
});

export type MeOutputType = z.infer<typeof MeOutput>;
