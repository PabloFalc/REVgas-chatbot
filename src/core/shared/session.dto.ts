import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { zIsoDatetime } from '../../utils/iso-datetime';

export const userSchema = z
  .object({
    id: z.uuidv7(),
    createdAt: zIsoDatetime,
    updatedAt: zIsoDatetime,
    email: z.email(),
    emailVerified: z.boolean(),
    name: z.string(),
    userName: z.string(),
    image: z.string().nullish(),
  })
  .describe('User');

export const sessionSchema = z
  .object({
    session: z
      .object({
        id: z.uuidv7(),
        createdAt: zIsoDatetime,
        updatedAt: zIsoDatetime,
        expiresAt: zIsoDatetime,
        userId: z.uuidv7(),
        token: z.string(),
        ipAddress: z.ipv4().nullish(),
        userAgent: z.string().nullish(),
      })
      .optional(),
    user: userSchema,
  })
  .describe('Session');

export const authTokenSchema = z
  .object({
    token: z.string(),
    user: userSchema,
  })
  .describe('AuthToken');

export type ISession = z.infer<typeof sessionSchema>;

export class SessionDto extends createZodDto(sessionSchema) {}
