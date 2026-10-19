export type ResetPasswordParams = {
  url: string;
  userName?: string;
};

export function resetPasswordTemplate({ url, userName }: ResetPasswordParams): {
  subject: string;
  html: string;
} {
  return {
    subject: 'Redefina sua senha',
    html: `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5;">
    <p>Olá${userName ? ` ${userName}` : ''},</p>
    <p>Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para criar uma nova senha:</p>
    <p>
      <a
        href="${url}"
        style="display: inline-block; padding: 12px 20px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px;"
      >
        Redefinir senha
      </a>
    </p>
    <p>Se o botão não funcionar, copie e cole este link no seu navegador:</p>
    <p><a href="${url}">${url}</a></p>
    <p>Se você não solicitou a redefinição, ignore este email — sua senha permanecerá a mesma.</p>
  </body>
</html>`,
  };
}
