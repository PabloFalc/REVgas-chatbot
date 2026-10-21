import type { Reply } from '../contracts/conversation.types';
import { clip } from './input';

const BUTTON_TITLE = 20;
const ROW_TITLE = 24;
const ROW_DESCRIPTION = 72;
const LIST_ROWS = 10;

interface Option {
  id: string;
  title: string;
  description?: string;
}

export function text(body: string): Reply {
  return { type: 'text', text: body };
}

export function buttons(body: string, options: Option[]): Reply {
  return {
    type: 'buttons',
    body,
    buttons: options.map(option => ({ id: option.id, title: clip(option.title, BUTTON_TITLE) })),
  };
}

export function list(
  body: string,
  buttonText: string,
  rows: Option[],
  sectionTitle?: string,
): Reply {
  return {
    type: 'list',
    body,
    buttonText,
    sections: [
      {
        ...(sectionTitle ? { title: sectionTitle } : {}),
        rows: rows.slice(0, LIST_ROWS).map(row => {
          const title = clip(row.title, ROW_TITLE);
          const description = row.description ?? (title !== row.title ? row.title : undefined);
          return {
            id: row.id,
            title,
            ...(description ? { description: clip(description, ROW_DESCRIPTION) } : {}),
          };
        }),
      },
    ],
  };
}
