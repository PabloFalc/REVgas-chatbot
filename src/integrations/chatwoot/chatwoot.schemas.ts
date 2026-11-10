import { z } from 'zod';

const contactSchema = z.looseObject({
  id: z.number(),
  identifier: z.string().nullish(),
  contact_inboxes: z
    .array(
      z.looseObject({
        source_id: z.string(),
        inbox: z.looseObject({ id: z.number() }),
      }),
    )
    .default([]),
});

export const searchContactsResponseSchema = z.looseObject({
  payload: z.array(contactSchema),
});

export const createContactResponseSchema = z.looseObject({
  payload: z.looseObject({
    contact: z.looseObject({ id: z.number() }),
    contact_inbox: z.looseObject({ source_id: z.string() }),
  }),
});

export const contactInboxResponseSchema = z.looseObject({ source_id: z.string() });

export const idResponseSchema = z.looseObject({ id: z.number() });
