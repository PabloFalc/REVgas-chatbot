import { Inject, Injectable } from '@nestjs/common';
import type { Resend } from 'resend';
import { createLogger } from 'src/config/plugins/pino.config';
import { env } from '../../../config/env';
import { InternalServerError } from '../../erros/http.errors';
import type { IEmailClient, SendEmailParams } from './email.interface';
import { RESEND } from './resend.client';
import { resetPasswordTemplate } from './templates/reset-password.template';
import { verifyEmailTemplate } from './templates/verify-email.template';

type SendTemplateParams = {
  to: string;
  url: string;
  userName?: string;
};

@Injectable()
export class EmailService implements IEmailClient {
  private readonly logger = createLogger(EmailService.name);

  constructor(@Inject(RESEND) private readonly resend: Resend) {}

  async send({ to, subject, html, from }: SendEmailParams): Promise<void> {
    const isProd = env.NODE_ENV === 'production';
    const isTest = env.NODE_ENV === 'test';
    const redirect = env.EMAIL_DEV_REDIRECT;

    if (isTest || (!isProd && !redirect)) {
      this.logger.info(
        { component: 'email', to, subject },
        `Email simulado (log-only): ${subject}`,
      );
      return;
    }

    const recipient = !isProd && redirect ? redirect : to;

    try {
      const { error } = await this.resend.emails.send({
        from: from ?? env.EMAIL_FROM,
        to: recipient,
        subject,
        html,
      });

      if (error) throw new Error(error.message);
    } catch (err) {
      this.logger.error({ component: 'email', err, to: recipient }, 'Email send error');
      throw new InternalServerError({ message: 'Falha ao enviar email', details: err });
    }
  }

  async sendVerificationEmail({ to, url, userName }: SendTemplateParams): Promise<void> {
    const { subject, html } = verifyEmailTemplate({ url, userName });
    await this.send({ to, subject, html });
  }

  async sendPasswordReset({ to, url, userName }: SendTemplateParams): Promise<void> {
    const { subject, html } = resetPasswordTemplate({ url, userName });
    await this.send({ to, subject, html });
  }
}
