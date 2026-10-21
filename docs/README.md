# Documentação

Toda a documentação do projeto, em português. Leia o guia da área antes de mexer no código
correspondente.

## Projeto (`project/`)

- [specs.md](./project/specs.md) — especificação técnica: stack, estrutura de pastas planejada,
  contratos de IA, integração com a API RevGás, confiabilidade
- [requisitos.md](./project/requisitos.md) — requisitos funcionais e não funcionais
- [funcionalidades.md](./project/funcionalidades.md) — funcionalidades (F01…) e prioridades
- [fluxo.md](./project/fluxo.md) — fluxo da conversa no WhatsApp
- [revgas-ai-flow.md](./project/revgas-ai-flow.md) — documento original do projeto (fonte dos demais)

## Guias de área

### Módulos (`guides/modules/`)

- [auth.md](./guides/modules/auth.md) — autenticação do painel (Better Auth, só token Bearer):
  status standby e como ligar, `AuthGuard`, `@AllowUnverified`, fluxos de email e rotas

### Integrações (`guides/integrations/`)

- [revgas.md](./guides/integrations/revgas.md) — cliente da API RevGás (`src/integrations/revgas`), organizado por módulo da API: modos
  `live`/`hybrid`/`fake`, roteamento do híbrido, permissões da chave, erros, regra de não repetir
  POST e o check manual `pnpm revgas:check`
- [whatsapp.md](./guides/integrations/whatsapp.md) — Cloud API da Meta (`src/integrations/whatsapp`)
  e o webhook (`src/modules/conversation`): modos `live`/`fake`, configuração no painel da Meta,
  teste local com túnel, assinatura, limites de botões/lista e erros
- [viacep.md](./guides/integrations/viacep.md) — cliente do ViaCEP (`src/integrations/viacep`): modos
  `live`/`fake` e busca de endereço por CEP no fluxo do pedido
- [llm.md](./guides/integrations/llm.md) — cliente da LLM (`src/integrations/llm`, Gemini pelo endpoint
  compatível com OpenAI): modos `live`/`fake`, chave, como um módulo consome, erros, `FakeLlmClient`,
  trocar de provedor e o check manual `pnpm llm:check`

### Serviços (`guides/services/`)

- [email-service.md](./guides/services/email-service.md) — `EmailService` (Resend), standby
  (só a auth usa) e o modo log-only em dev/test

### Convenções (`guides/conventions/`)

- [api-doc.md](./guides/conventions/api-doc.md) — o decorator `@ApiDoc` (Swagger + validação de
  resposta com Zod)
- [environment.md](./guides/conventions/environment.md) — variáveis de ambiente: função,
  obrigatoriedade, defaults e consequências de cada uma
- [testing.md](./guides/conventions/testing.md) — como escrever testes (unit + e2e), os helpers
  `createApp(extraImports)`, os helpers `deleteBy`/`signIn`/`signUpVerified`/`bearer`, limpeza
  escopada e as armadilhas do e2e
- [ci-cd.md](./guides/conventions/ci-cd.md) — os workflows do `.github` e o gitflow
  develop/staging/main

## Segurança

- [security/SECURITY.md](./security/SECURITY.md) — referência viva de segurança: vetores de
  ataque e mitigações, gestão de credenciais e itens planejados (LGPD, API Key RevGás)
- [security/README.md](./security/README.md) — índice da área de segurança

## Arquitetura

- [architecture/infra-organization.md](./architecture/infra-organization.md) — organização da
  camada `src/infra` (cache, database, health) e recomendações de estrutura
