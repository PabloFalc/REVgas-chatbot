import { Body, Controller, Headers, Inject, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ApiDoc } from 'src/core/decorators/api-doc/api-doc.decorator';
import { Public } from 'src/core/decorators/auth/auth-metadata.decorator';
import { BadRequestError, UnauthorizedError } from 'src/core/erros/http.errors';
import { WEBHOOK_THROTTLE } from 'src/core/guards/rate-limit.guard';
import {
  CHATWOOT_WEBHOOK,
  type ChatwootWebhook,
} from 'src/integrations/chatwoot/webhook/chatwoot-webhook';
import { DeskEventsService } from './desk-events.service';
import { receiveDeskWebhookDocument } from './docs/desk-webhook.doc';

@Public()
@Throttle(WEBHOOK_THROTTLE)
@Controller('/webhooks/chatwoot')
export class DeskWebhookController {
  constructor(
    @Inject(CHATWOOT_WEBHOOK) private readonly webhook: ChatwootWebhook,
    @Inject(DeskEventsService) private readonly events: DeskEventsService,
  ) {}

  @ApiDoc(receiveDeskWebhookDocument)
  @Post('/')
  receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-chatwoot-signature') signature: string | undefined,
    @Headers('x-chatwoot-timestamp') timestamp: string | undefined,
    @Body() body: unknown,
  ) {
    if (!this.webhook.isAuthentic(request.rawBody, signature, timestamp, Date.now())) {
      throw new UnauthorizedError({ message: 'Assinatura do webhook inválida' });
    }
    const events = this.webhook.parse(body);
    if (events === null) {
      throw new BadRequestError({ message: 'Evento do Chatwoot inválido' });
    }
    void this.events.handle(events);
    return { received: true as const };
  }
}
