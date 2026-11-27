# CI/CD

Toda a automação vive em [`.github/workflows/`](../../../.github/workflows): quatro workflows do
GitHub Actions. Não há release automatizado (sem semantic-release, sem `CHANGELOG.md`) nem deploy
no pipeline por enquanto. O fluxo segue um **gitflow**:

```
feature/* ──PR──▶ develop ──▶ staging ──▶ main
                  (integra)   (beta)      (estável)
```

| Branch | Papel | O que dispara |
|---|---|---|
| `develop` | Integração das features | `pull-request.yml` (PR e push) |
| `refactor` | Integração atual do refactor | `ci-cd.yml` no push → testes + build + imagem no GHCR; `docker-smoke.yml` |
| `staging` | Homologação | `ci-cd.yml` no push → testes + build + imagem no GHCR |
| `main` | Estável | `ci-cd.yml` no push → testes + build + imagem no GHCR |

> PRs para `develop`, `staging` **e** `main` rodam a suíte completa antes do merge (gate). O
> `ci-cd.yml` só roda **depois** do merge (no push) e revalida testes + build.

---

## Os workflows

### `tests.yml` — suíte reutilizável

É um **workflow reutilizável** (`on: workflow_call`): não roda sozinho, é chamado pelos outros
dois via `uses: ./.github/workflows/tests.yml`. Centraliza a definição dos testes num lugar só.

Jobs (rodam em paralelo):

| Job | O que faz | Precisa de infra? |
|---|---|---|
| `lint` | `pnpm lint` (Biome) | Não |
| `unit-tests` | `pnpm test` (Vitest) | **Não** — os `*.spec.ts` mockam tudo |
| `e2e-tests` | `pnpm db:migrate` + `pnpm test:e2e` | **Sim** — Postgres 17 (pgvector) + Redis 7 (services) |

- **Env de teste inline** (`env:` no topo): `NODE_ENV=test`, secrets de teste, `DATABASE_URL`
  apontando para o Postgres efêmero etc. **Não são segredos reais** — são serviços locais do
  runner. Por isso ficam no arquivo, não em `secrets`. Ver [environment.md](./environment.md).
- **`unit-tests` não sobe banco** de propósito: os testes unitários usam `Test.createTestingModule`
  com providers mockados. Só o e2e precisa de Postgres/Redis.
- `permissions: contents: read` (mínimo) e `timeout-minutes` por job (teto contra job travado).

### `pull-request.yml` — gate de PR

```yaml
on:
  push:        { branches: [develop] }
  pull_request: { branches: [develop, staging, main] }
```

Chama o `tests.yml`. Garante que **nenhum PR** para as branches do gitflow seja mergeado sem a
suíte passar. Tem `concurrency` com `cancel-in-progress: true` — um novo push no mesmo PR
**cancela** o run anterior (economiza minutos).

### `ci-cd.yml` — "CI Pipeline"

Dispara no **push** para `refactor`/`staging`/`main` (ou seja, após o merge). Encadeia:

```
call-tests ──┬─▶ build
(tests.yml)  │   (pnpm build)
             └─▶ publish
                 (imagem no GHCR)
```

- **`build`**: roda `pnpm build` como gate de "o projeto compila?". Não gera artefato.
- `permissions: contents: read` em todo o arquivo.
- **`concurrency` com `cancel-in-progress: false`**: runs da mesma branch são serializados.

- **`publish`**: constrói a imagem `linux/amd64` e publica no GHCR depois que os testes passam.
  Não faz deploy. Detalhes na seção abaixo.

> Um job de deploy (quando houver ambiente de hospedagem definido) entra aqui, depois do `publish`.

### Imagem no GHCR

O job `publish` usa só o `GITHUB_TOKEN` (permissões `contents: read` e `packages: write`, só nesse
job) e publica em `ghcr.io/<owner>/<repo>` em minúsculas, ou seja `ghcr.io/pablofalc/revgas-chatbot`.
PRs nunca publicam. Pushes seguidos na mesma branch cancelam o `publish` anterior.

Tags geradas a cada push:

| Tag | Exemplo | Uso |
|---|---|---|
| `sha-<7 dígitos>` | `sha-a1b2c3d` | Imutável. Use para deploy e rollback. |
| nome da branch | `refactor`, `staging`, `main` | Móvel, aponta para o último push da branch. |

Para puxar:

```bash
docker pull ghcr.io/pablofalc/revgas-chatbot:sha-a1b2c3d
```

O pacote nasce **privado**. Quem puxa (o servidor, por exemplo) precisa fazer login com um token
que tenha o escopo `read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <usuario-github> --password-stdin
```

Se o pacote não herdar o acesso do repositório, dê acesso ao repositório em Package settings do
GitHub, ou torne o pacote público.

### `docker-smoke.yml` — smoke test da imagem

Roda em PR para `refactor` e em push para `refactor`. Constrói a imagem do `Dockerfile` (cache do
Actions via `type=gha`), sobe Postgres 17 com pgvector (service) e Redis 7 com senha (`docker run`,
porque em produção a app exige `REDIS_PASSWORD`), inicia o contêiner com `NODE_ENV=production` e
`RUN_MIGRATIONS=true` e espera `200` em `/health` por até 2 min. Em falha, imprime os logs do contêiner.

- Só valores fictícios; todas as integrações em `fake`/`off` (`CHATWOOT_MODE=off` com `STORE_PHONE`,
  porque em produção `fake` é recusado).
- Valida que a imagem sobe, que as migrations rodam dentro dela e que o `/health` enxerga Postgres e Redis.

---

## Operação

- **Versões pinadas:** Node `24` e pnpm `10.33.0` em todos os jobs (este último alinhado ao
  `packageManager` do `package.json`). Mude nos dois lugares ao atualizar.
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`…) via `git commit` direto.
- **Secrets:** os valores em `tests.yml` são de teste e podem ficar no arquivo. **Não** coloque
  secrets reais (ex.: `REVGAS_API_KEY`) nos workflows de teste. Variáveis da app: ver
  [environment.md](./environment.md).

### Como adicionar um job de teste

Adicione ao `tests.yml` (não aos outros) — ele é o ponto único, e os dois pipelines herdam
automaticamente.

---

## Extras recomendados (ainda não implementados)

Duas melhorias comuns de CI/manutenção que **não estão ativas** neste projeto. Não são
dependências do app (não vão para o `package.json`) — são ferramentas do GitHub. Implemente se
quiser.

### actionlint — lint dos próprios workflows

`actionlint` valida os `.github/workflows/*.yml` e pega erros antes do push (YAML inválido,
expressão `${{ }}` quebrada, `needs:` inexistente, `shellcheck` nos `run:`).

- **Local:** instale o binário ([rhysd/actionlint](https://github.com/rhysd/actionlint)) e rode
  `actionlint` na raiz do repo.
- **No CI:** adicione um job ao `tests.yml` (ponto único, herdado pelos dois pipelines):

  ```yaml
  actionlint:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: reviewdog/action-actionlint@v1
        with:
          fail_on_error: true
  ```

### Dependabot — atualização automática de dependências

Dependabot é nativo do GitHub: configurado, ele abre PRs periódicos atualizando deps npm
(`package.json`/`pnpm-lock.yaml`) e as versões das GitHub Actions (`actions/checkout@v4` etc.).

- **Como ativar:** crie `.github/dependabot.yml`. Esqueleto sugerido (PRs semanais, agrupados
  para reduzir ruído):

  ```yaml
  version: 2
  updates:
    - package-ecosystem: npm
      directory: "/"
      schedule: { interval: weekly }
      open-pull-requests-limit: 10
      groups:
        production-dependencies:
          dependency-type: production
          update-types: [minor, patch]
        development-dependencies:
          dependency-type: development
          update-types: [minor, patch]
    - package-ecosystem: github-actions
      directory: "/"
      schedule: { interval: weekly }
      groups:
        github-actions:
          update-types: [minor, patch]
  ```

- O `package-ecosystem: npm` entende lockfile do pnpm. Opcional: adicionar `reviewers:`/`labels:`.

---
