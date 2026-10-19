import { z } from 'zod';

export const httpReplySchema = z.object({
  name: z.string(),
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
  timestamp: z.string(),
  details: z.unknown(),
  path: z.string(),
});

export type HttpBaseReply = z.infer<typeof httpReplySchema>;
