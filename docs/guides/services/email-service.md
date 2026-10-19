# Serviço de Email (EmailService)

O `EmailService` é a abstração do projeto para envio de emails transacionais usando o
[Resend](https://resend.com). Ele centraliza o envio, esconde os detalhes do provedor e aplica
automaticamente um comportamento seguro entre ambientes de desenvolvimento e produção.

> **Status: standby.** O código está presente, mas o único consumidor é o Better Auth (verificação
> de email, reset de senha e troca de email do login do painel), que também está em standby — ver
> [auth.md](../modules/auth.md#status-standby). O chatbot não envia email. As variáveis
> `RESEND_API_KEY`/`EMAIL_*` são todas opcionais.

## Onde ele fica

```
src/core/services/email/
├── email.module.ts                       # módulo global que registra e exporta o serviço
├── email.service.ts                      # EmailService (implementação)
├── email.interface.ts                    # IEmailClient + SendEmailParams
├── resend.client.ts                      # cliente Resend (singleton) + token de DI RESEND
├── email.service.spec.ts                 # testes do serviço
└── templates/
    ├── verify-email.template.ts          # template de verificação de email
    └── reset-password.template.ts        # template de redefinição de senha
```

O `EmailModule` é `@Global()`, mas **não** é importado pelo `AppModule`: quem o importa é o
`AuthModule` (`src/modules/auth/auth.module.ts`). Ou seja, o `EmailService` só fica disponível na
DI quando a auth está ligada. Se outro módulo precisar de email com a auth desligada, importe o
`EmailModule` nele (ou no `AppModule`).

O singleton do Better Auth (`src/modules/auth/auth.ts`) fica fora do container de DI e por isso
instancia o seu próprio `new EmailService(resend)` — usado em `sendResetPassword`,
`emailVerification.sendVerificationEmail` e `user.changeEmail.sendChangeEmailVerification`.

## Configuração

As variáveis ficam validadas via Zod em `src/config/env.ts`:

| Variável             | Obrigatória         | Padrão                  | Descrição                                                              |
| -------------------- | ------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `RESEND_API_KEY`     | Não (standby; sim em produção com a auth ligada) | vazio = não definida | Chave da API do Resend. Sem ela o cliente usa um placeholder; em dev/test o envio é log-only. |
| `EMAIL_FROM`         | Não                 | `onboarding@resend.dev` | Remetente. Aceita `"Nome <no-reply@seudominio.com>"`.                  |
| `EMAIL_DEV_REDIRECT` | Não (apenas em dev) | vazio = não definida    | Redireciona todos os emails para este endereço em ambiente de dev. Validada como email. |

Exemplo no `.env`:

```dotenv
# RESEND
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=onboarding@resend.dev
EMAIL_DEV_REDIRECT=seu-email@gmail.com
```

> O `.env` é ignorado pelo git. Nunca comite chaves reais — use o `.env.example` como referência
> e os secrets do servidor/CI em produção.

### Comportamento por ambiente (modo híbrido)

A **assinatura pública do serviço não muda** entre ambientes. A diferença fica encapsulada dentro
do método `send`, com base em `NODE_ENV` e na presença de `EMAIL_DEV_REDIRECT`:

| Ambiente                                | Comportamento                                                              |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `production`                            | Envia normalmente via Resend usando `EMAIL_FROM`.                         |
| `test`                                  | **Sempre log-only** (testes automatizados nunca enviam email real).       |
| `development` sem `EMAIL_DEV_REDIRECT`  | **Log-only**: não chama o Resend, apenas registra `to`/`subject` no logger. |
| `development` com `EMAIL_DEV_REDIRECT`  | Envia de verdade, mas força o destinatário para o endereço de redirect.   |

Isso evita disparar emails reais (tokens de verificação/redefinição) para usuários reais durante o
desenvolvimento.

## Uso básico

Injete o `EmailService` por construtor, como qualquer provider do Nest:

```ts
import { Injectable } from '@nestjs/common';
import { EmailService } from 'src/core/services/email/email.service';

@Injectable()
export class WelcomeService {
  constructor(private readonly email: EmailService) {}

  async notify(user: { email: string; name: string }) {
    await this.email.sendVerificationEmail({
      to: user.email,
      url: 'https://app.seudominio.com/verify?token=abc',
      userName: user.name,
    });
  }
}
```

### API pública

```ts
// envio genérico (recebe HTML pronto)
send(params: SendEmailParams): Promise<void>;

// métodos de conveniência (montam o HTML a partir de um template)
sendVerificationEmail(params: { to: string; url: string; userName?: string }): Promise<void>;
sendPasswordReset(params: { to: string; url: string; userName?: string }): Promise<void>;
```

`SendEmailParams` (em `email.interface.ts`):

```ts
export type SendEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string; // sobrescreve o EMAIL_FROM padrão
};
```

Em caso de falha no envio, o `send` lança um `InternalServerError`
(`src/core/erros/http.errors.ts`), que é tratado pelo filtro global de exceções.

## Criando um novo template

Templates são **funções puras** que recebem props tipadas e retornam `{ subject, html }`. Não têm
dependência de framework — apenas TypeScript e strings de HTML.

1. Crie o arquivo em `src/core/services/email/templates/`:

```ts
// src/core/services/email/templates/welcome.template.ts
export type WelcomeParams = {
  userName: string;
  dashboardUrl: string;
};

export function welcomeTemplate({ userName, dashboardUrl }: WelcomeParams): {
  subject: string;
  html: string;
} {
  return {
    subject: 'Bem-vindo!',
    html: `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5;">
    <p>Olá ${userName},</p>
    <p>Sua conta está pronta. Acesse seu painel:</p>
    <p>
      <a
        href="${dashboardUrl}"
        style="display: inline-block; padding: 12px 20px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px;"
      >
        Acessar painel
      </a>
    </p>
  </body>
</html>`,
  };
}
```

Boas práticas de template:

- **HTML inline + estilos inline**: muitos clientes de email ignoram `<style>` e CSS externo.
  Use atributos `style="..."` diretamente nos elementos.
- **Sempre inclua o link em texto** além do botão, para clientes que não renderizam botões.
- **Mantenha o template "burro"**: ele só formata dados de entrada. Não busque dados, não acesse
  banco e não tenha lógica de negócio.
- **Cuidado com dados não confiáveis**: não interpole HTML arbitrário vindo do usuário dentro do
  template. Use apenas valores controlados (URLs geradas pela aplicação, nomes já validados).

## Adicionando um novo método ao EmailService

Os métodos de conveniência seguem sempre o mesmo padrão: montam o HTML a partir de um template e
delegam para o `send` (que cuida do envio e do comportamento por ambiente).

```ts
// dentro de src/core/services/email/email.service.ts
import { welcomeTemplate } from './templates/welcome.template';

async sendWelcome({ to, userName, dashboardUrl }: {
  to: string;
  userName: string;
  dashboardUrl: string;
}): Promise<void> {
  const { subject, html } = welcomeTemplate({ userName, dashboardUrl });
  await this.send({ to, subject, html });
}
```

Pontos importantes:

- **Sempre delegue para `send`** em vez de chamar `this.resend.emails.send` diretamente. Assim o
  novo método herda de graça o modo log-only/redirect e o tratamento de erro.
- **Não acople o método a uma rota específica**: o `EmailService` é uma abstração de envio, não
  conhece controllers nem regras de negócio. Quem decide *quando* enviar é o chamador.

## Escrevendo testes

Os testes usam Vitest com mocks. O cliente Resend é injetado como mock e o módulo de env é mockado
para controlar o ambiente em cada caso.

```ts
import { Test } from '@nestjs/testing';
import { EmailService } from './email.service';
import { RESEND } from './resend.client';

vi.mock('src/config/env', () => ({
  env: {
    NODE_ENV: 'production',
    EMAIL_FROM: 'no-reply@test.com',
    EMAIL_DEV_REDIRECT: undefined,
  },
}));

const mockResend = { emails: { send: vi.fn() } };

describe('EmailService.sendWelcome', () => {
  let service: EmailService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockResend.emails.send.mockResolvedValue({ data: { id: '1' }, error: null });

    const moduleRef = await Test.createTestingModule({
      providers: [EmailService, { provide: RESEND, useValue: mockResend }],
    }).compile();

    service = moduleRef.get(EmailService);
  });

  it('delega para send com o assunto e o link corretos', async () => {
    await service.sendWelcome({
      to: 'user@exemplo.com',
      userName: 'Pablo',
      dashboardUrl: 'https://app/painel',
    });

    expect(mockResend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@exemplo.com',
        subject: 'Bem-vindo!',
        html: expect.stringContaining('https://app/painel'),
      }),
    );
  });
});
```

Casos que vale a pena cobrir:

- **produção**: `resend.emails.send` é chamado com o destinatário original e o `from` padrão;
- **dev sem redirect**: `resend.emails.send` **não** é chamado (log-only);
- **dev com redirect**: o `to` é forçado para o `EMAIL_DEV_REDIRECT`;
- **erro**: quando o Resend retorna `{ error }`, o `send` lança `InternalServerError`.

> Para controlar o ambiente entre testes, reatribua as propriedades do `env` mockado dentro do
> `beforeEach` ou de cada `it` (ex.: `env.NODE_ENV = 'development'`).

### Teste de envio real (manual)

Para confirmar que o email realmente chega na sua caixa de entrada, configure no `.env` uma
`RESEND_API_KEY` válida e `EMAIL_DEV_REDIRECT=seu-email`. Em seguida, injete o `EmailService` em um
ponto temporário e chame `sendVerificationEmail`. Lembre-se de **remover o código temporário** após
validar e nunca deixá-lo em um arquivo `*.spec.ts` (rodaria no `pnpm test` e dispararia emails
reais a cada execução).

## Boas práticas

- **Produção precisa de domínio verificado.** Sem domínio verificado, o Resend só permite enviar de
  `onboarding@resend.dev` e **apenas para o email dono da conta**. Para enviar a qualquer
  destinatário, verifique seu domínio no Resend (registros DNS: SPF, DKIM, DMARC) e use um
  `EMAIL_FROM` desse domínio.
- **Chaves separadas por ambiente.** Use uma `RESEND_API_KEY` para dev e outra para produção, para
  poder revogar isoladamente e restringir escopo/domínio.
- **Nunca comite segredos.** O `.env` está no `.gitignore`; mantenha as chaves reais fora do
  versionamento.
- **Mantenha o serviço agnóstico.** O `EmailService` só envia. Regras de negócio (quando enviar, para
  quem, com qual conteúdo) ficam nos módulos que o consomem.
- **Envio assíncrono em fluxos sensíveis a latência.** Se o envio não precisar bloquear a resposta
  HTTP (ex.: email de boas-vindas), considere disparar em background para não atrasar a requisição.
- **Trate o envio como falível.** Email depende de um serviço externo; sempre assuma que pode falhar
  e decida se o erro deve interromper o fluxo ou apenas ser logado.

## Resumo do fluxo

```
Módulo consumidor
   └─ EmailService.sendX()        // método de conveniência
         └─ template()            // monta { subject, html }
               └─ EmailService.send()   // aplica regra de ambiente + envia/loga
                     └─ Resend (em produção ou modo redirect)
```
