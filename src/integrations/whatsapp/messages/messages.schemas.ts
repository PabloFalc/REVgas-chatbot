import { z } from 'zod';

const recipient = z.string().regex(/^\d{8,15}$/, 'telefone em formato wa_id (só dígitos, com DDI)');

const header = z.string().min(1).max(60).optional();
const footer = z.string().min(1).max(60).optional();
const interactiveBody = z.string().min(1).max(1024);

export const textMessageSchema = z.object({
  to: recipient,
  text: z.string().min(1).max(4096),
  previewUrl: z.boolean().optional(),
});

export const buttonSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string().min(1).max(20),
});

export const buttonsMessageSchema = z.object({
  to: recipient,
  body: interactiveBody,
  header,
  footer,
  buttons: z
    .array(buttonSchema)
    .min(1)
    .max(3)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, {
      message: 'ids de botão repetidos',
    }),
});

export const listRowSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(24),
  description: z.string().min(1).max(72).optional(),
});

export const listSectionSchema = z.object({
  title: z.string().min(1).max(24).optional(),
  rows: z.array(listRowSchema).min(1),
});

export const listMessageSchema = z
  .object({
    to: recipient,
    body: interactiveBody,
    header,
    footer,
    buttonText: z.string().min(1).max(20),
    sections: z.array(listSectionSchema).min(1).max(10),
  })
  .superRefine((value, ctx) => {
    const rows = value.sections.flatMap(section => section.rows);
    if (rows.length > 10) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'no máximo 10 opções' });
    }
    if (new Set(rows.map(row => row.id)).size !== rows.length) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'ids de opção repetidos' });
    }
    if (value.sections.length > 1 && value.sections.some(section => !section.title)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'com mais de uma seção, toda seção precisa de título',
      });
    }
  });

export const sendResponseSchema = z.looseObject({
  messages: z.array(z.looseObject({ id: z.string().min(1) })).min(1),
});

export type TextMessage = z.input<typeof textMessageSchema>;
export type WhatsappButton = z.infer<typeof buttonSchema>;
export type ButtonsMessage = z.input<typeof buttonsMessageSchema>;
export type WhatsappListRow = z.infer<typeof listRowSchema>;
export type WhatsappListSection = z.infer<typeof listSectionSchema>;
export type ListMessage = z.input<typeof listMessageSchema>;

export interface SentMessage {
  id: string;
}
