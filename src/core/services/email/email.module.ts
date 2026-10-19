import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { RESEND, resendClient } from './resend.client';

@Global()
@Module({
  providers: [EmailService, resendClient],
  exports: [EmailService, RESEND],
})
export class EmailModule {}
