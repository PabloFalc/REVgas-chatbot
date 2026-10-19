import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const revokeSessionSchema = z.object({ token: z.string() }).describe('RevokeSession');

export class RevokeSessionDto extends createZodDto(revokeSessionSchema) {}
