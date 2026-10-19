export type SendEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
};

export abstract class IEmailClient {
  abstract send(params: SendEmailParams): Promise<void>;
}
