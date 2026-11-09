import type { Reply } from './contracts/conversation.types';

export function replyText(reply: Reply): string {
  if (reply.type === 'text') return reply.text;
  if (reply.type === 'buttons') {
    return [reply.body, ...reply.buttons.map(button => `[${button.title}]`)].join('\n');
  }
  const rows = reply.sections.flatMap(section => section.rows);
  return [
    reply.body,
    ...rows.map(row =>
      row.description ? `- ${row.title} (${row.description})` : `- ${row.title}`,
    ),
  ].join('\n');
}
