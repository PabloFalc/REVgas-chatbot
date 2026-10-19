import { Resend } from 'resend';
import { env } from '../../../config/env';

export const RESEND = 'RESEND_CLIENT';

export const resend = new Resend(env.RESEND_API_KEY ?? 're_placeholder');

export const resendClient = {
  provide: RESEND,
  useFactory: () => resend,
};
