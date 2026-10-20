export type IncomingContent =
  | { type: 'text'; text: string }
  | { type: 'choice'; id: string; title?: string }
  | { type: 'unsupported' };

export interface IncomingMessage {
  id: string;
  from: string;
  name?: string;
  content: IncomingContent;
}

export interface ReplyOption {
  id: string;
  title: string;
  description?: string;
}

export type Reply =
  | { type: 'text'; text: string }
  | { type: 'buttons'; body: string; buttons: ReplyOption[] }
  | {
      type: 'list';
      body: string;
      buttonText: string;
      sections: Array<{ title?: string; rows: ReplyOption[] }>;
    };
