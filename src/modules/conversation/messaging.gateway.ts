import { Inject, Injectable } from '@nestjs/common';
import { WHATSAPP_CLIENT, type WhatsappClient } from 'src/integrations/whatsapp/whatsapp.client';
import type { Reply } from './contracts/conversation.types';

@Injectable()
export class MessagingGateway {
  constructor(@Inject(WHATSAPP_CLIENT) private readonly whatsapp: WhatsappClient) {}

  async send(to: string, reply: Reply): Promise<void> {
    switch (reply.type) {
      case 'text':
        await this.whatsapp.sendText({ to, text: reply.text });
        return;
      case 'buttons':
        await this.whatsapp.sendButtons({
          to,
          body: reply.body,
          buttons: reply.buttons.map(({ id, title }) => ({ id, title })),
        });
        return;
      case 'list':
        await this.whatsapp.sendList({
          to,
          body: reply.body,
          buttonText: reply.buttonText,
          sections: reply.sections,
        });
        return;
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.whatsapp.markAsRead(messageId);
  }
}
