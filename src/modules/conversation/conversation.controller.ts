import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';
import { Public } from 'src/core/decorators/auth/auth-metadata.decorator';
import { ForbiddenError, UnauthorizedError } from 'src/core/erros/http.errors';
import { WEBHOOK_THROTTLE } from 'src/core/guards/rate-limit.guard';
import {
  WHATSAPP_WEBHOOK,
  type WhatsappWebhook,
} from 'src/integrations/whatsapp/webhook/whatsapp-webhook';
import { VerificationQueryDto } from './contracts/verification-query.dto';
import { ConversationService } from './conversation.service';
import { receiveWebhookDocument, verifyWebhookDocument } from './docs/webhook.doc';

@Public()
@Throttle(WEBHOOK_THROTTLE)
@Controller('/webhooks/whatsapp')
export class ConversationController {
  constructor(
    @Inject(WHATSAPP_WEBHOOK) private readonly webhook: WhatsappWebhook,
    @Inject(ConversationService) private readonly conversation: ConversationService,
  ) {}

  @ApiDoc(verifyWebhookDocument)
  @Get('/')
  verify(
    @Query() query: VerificationQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): string {
    const challenge = this.webhook.challenge(query);
    if (challenge === null) {
      throw new ForbiddenError({ message: 'Verify token inválido' });
    }
    reply.type('text/plain; charset=utf-8');
    return challenge;
  }

  @ApiDoc(receiveWebhookDocument)
  @Post('/')
  receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    if (!this.webhook.isAuthentic(request.rawBody, signature)) {
      throw new UnauthorizedError({ message: 'Assinatura do webhook inválida' });
    }
    void this.conversation.handle(this.webhook.parse(body));
    return { received: true as const };
  }
}
