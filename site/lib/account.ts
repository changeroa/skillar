import { z } from 'zod';

export const userSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(320),
  name: z.string().max(1024),
  picture: z.union([z.literal(''), z.url().refine(value => value.startsWith('https://'))]),
  createdAt: z.number().int().nonnegative(),
  lastLogin: z.number().int().nonnegative(),
}).readonly();

export const sessionResponseSchema = z.object({ user: userSchema.nullable() });
export type SessionUser = z.infer<typeof userSchema>;
