import { Test } from '@nestjs/testing';
import { env } from 'src/config/env';
import { InternalServerError } from 'src/core/erros/http.errors';
import { EmailService } from './email.service';
import { RESEND } from './resend.client';

vi.mock('src/config/env', () => ({
  env: {
    NODE_ENV: 'production',
    EMAIL_FROM: 'no-reply@test.com',
    EMAIL_DEV_REDIRECT: undefined,
  },
}));

const mockResend = {
  emails: {
    send: vi.fn(),
  },
};

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    vi.clearAllMocks();
    env.NODE_ENV = 'production';
    env.EMAIL_DEV_REDIRECT = undefined;
    mockResend.emails.send.mockResolvedValue({ data: { id: '1' }, error: null });

    const moduleRef = await Test.createTestingModule({
      providers: [EmailService, { provide: RESEND, useValue: mockResend }],
    }).compile();

    service = moduleRef.get(EmailService);
  });

  describe('send', () => {
    it('em produção envia para o destinatário original com o from padrão', async () => {
      await service.send({ to: 'user@exemplo.com', subject: 'Olá', html: '<p>hi</p>' });

      expect(mockResend.emails.send).toHaveBeenCalledTimes(1);
      expect(mockResend.emails.send).toHaveBeenCalledWith({
        from: 'no-reply@test.com',
        to: 'user@exemplo.com',
        subject: 'Olá',
        html: '<p>hi</p>',
      });
    });

    it('usa o from informado quando fornecido', async () => {
      await service.send({
        to: 'user@exemplo.com',
        subject: 'Olá',
        html: '<p>hi</p>',
        from: 'custom@exemplo.com',
      });

      expect(mockResend.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'custom@exemplo.com' }),
      );
    });

    it('em dev sem redirect apenas loga (não chama o Resend)', async () => {
      env.NODE_ENV = 'development';
      env.EMAIL_DEV_REDIRECT = undefined;

      await service.send({ to: 'user@exemplo.com', subject: 'Olá', html: '<p>hi</p>' });

      expect(mockResend.emails.send).not.toHaveBeenCalled();
    });

    it('em ambiente de test é sempre log-only, mesmo com redirect', async () => {
      env.NODE_ENV = 'test';
      env.EMAIL_DEV_REDIRECT = 'dev@exemplo.com';

      await service.send({ to: 'user@exemplo.com', subject: 'Olá', html: '<p>hi</p>' });

      expect(mockResend.emails.send).not.toHaveBeenCalled();
    });

    it('em dev com redirect envia para o endereço de teste', async () => {
      env.NODE_ENV = 'development';
      env.EMAIL_DEV_REDIRECT = 'dev@exemplo.com';

      await service.send({ to: 'user@exemplo.com', subject: 'Olá', html: '<p>hi</p>' });

      expect(mockResend.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'dev@exemplo.com' }),
      );
    });

    it('lança InternalServerError quando o Resend retorna erro', async () => {
      mockResend.emails.send.mockResolvedValue({ data: null, error: { message: 'boom' } });

      await expect(
        service.send({ to: 'user@exemplo.com', subject: 'Olá', html: '<p>hi</p>' }),
      ).rejects.toBeInstanceOf(InternalServerError);
    });
  });

  describe('métodos de conveniência', () => {
    it('sendVerificationEmail delega para send com o assunto e link corretos', async () => {
      await service.sendVerificationEmail({ to: 'user@exemplo.com', url: 'https://app/verify' });

      expect(mockResend.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@exemplo.com',
          subject: 'Verifique seu email',
          html: expect.stringContaining('https://app/verify'),
        }),
      );
    });

    it('sendPasswordReset delega para send com o assunto e link corretos', async () => {
      await service.sendPasswordReset({ to: 'user@exemplo.com', url: 'https://app/reset' });

      expect(mockResend.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@exemplo.com',
          subject: 'Redefina sua senha',
          html: expect.stringContaining('https://app/reset'),
        }),
      );
    });
  });
});
