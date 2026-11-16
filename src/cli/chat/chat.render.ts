import { z } from 'zod';

export interface MenuOption {
  kind: 'button' | 'list';
  id: string;
  title: string;
}

export interface RenderedMessage {
  lines: string[];
  options: MenuOption[] | null;
}

const PREFIX = 'bot › ';
const INDENT = ' '.repeat(PREFIX.length);

const rowSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
});

const textSchema = z.looseObject({
  type: z.literal('text'),
  text: z.looseObject({ body: z.string() }),
});

const interactiveSchema = z.looseObject({
  type: z.literal('interactive'),
  interactive: z.looseObject({
    type: z.enum(['button', 'list']),
    header: z.looseObject({ text: z.string() }).optional(),
    body: z.looseObject({ text: z.string() }),
    footer: z.looseObject({ text: z.string() }).optional(),
    action: z.looseObject({
      button: z.string().optional(),
      buttons: z.array(z.looseObject({ reply: rowSchema })).optional(),
      sections: z
        .array(z.looseObject({ title: z.string().optional(), rows: z.array(rowSchema) }))
        .optional(),
    }),
  }),
});

type Interactive = z.infer<typeof interactiveSchema>['interactive'];

function prefixed(lines: string[]): string[] {
  return lines.map((line, index) => (index === 0 ? PREFIX : INDENT) + line);
}

function renderButtons(interactive: Interactive, lines: string[]): MenuOption[] {
  const options = (interactive.action.buttons ?? []).map(({ reply }) => ({
    kind: 'button' as const,
    id: reply.id,
    title: reply.title,
  }));
  lines.push(options.map((option, index) => `[${index + 1}] ${option.title}`).join('  '));
  return options;
}

function renderList(interactive: Interactive, lines: string[]): MenuOption[] {
  const options: MenuOption[] = [];
  if (interactive.action.button) lines.push(`≡ ${interactive.action.button}`);
  for (const section of interactive.action.sections ?? []) {
    if (section.title) lines.push(section.title);
    for (const row of section.rows) {
      options.push({ kind: 'list', id: row.id, title: row.title });
      const description = row.description ? ` — ${row.description}` : '';
      lines.push(`  [${options.length}] ${row.title}${description}`);
    }
  }
  return options;
}

export function renderMessage(body: Record<string, unknown>): RenderedMessage {
  const text = textSchema.safeParse(body);
  if (text.success) {
    return { lines: prefixed(text.data.text.body.split('\n')), options: null };
  }

  const parsed = interactiveSchema.safeParse(body);
  if (!parsed.success) {
    const type = typeof body.type === 'string' ? body.type : 'desconhecido';
    return { lines: prefixed([`[mensagem do tipo ${type}]`]), options: null };
  }

  const { interactive } = parsed.data;
  const lines: string[] = [];
  if (interactive.header) lines.push(`*${interactive.header.text}*`);
  lines.push(...interactive.body.text.split('\n'));
  if (interactive.footer) lines.push(`(${interactive.footer.text})`);
  const options =
    interactive.type === 'button'
      ? renderButtons(interactive, lines)
      : renderList(interactive, lines);
  return { lines: prefixed(lines), options };
}
