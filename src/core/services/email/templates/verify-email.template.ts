export type VerifyEmailParams = {
  url: string;
  userName?: string;
};

export function verifyEmailTemplate({ url, userName }: VerifyEmailParams): {
  subject: string;
  html: string;
} {
  return {
    subject: 'Verifique seu email',
    html: `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5;">
    <p>Olá${userName ? ` ${userName}` : ''},</p>
    <p>Obrigado por se cadastrar. Confirme seu endereço de email clicando no botão abaixo:</p>
    <p>
      <a
        href="${url}"
        style="display: inline-block; padding: 12px 20px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px;"
      >
        Verificar email
      </a>
    </p>
    <p>Se o botão não funcionar, copie e cole este link no seu navegador:</p>
    <p><a href="${url}">${url}</a></p>
    <p>Se você não criou esta conta, ignore este email.</p>
  </body>
</html>`,
  };
}
