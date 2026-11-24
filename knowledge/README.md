# Base de conhecimento

Esta pasta guarda a base de conhecimento da revenda usada pelo assistente para responder perguntas.

- `base/`: arquivos Markdown ingeridos por `pnpm kb:ingest`. Cada seção `##` vira um trecho.
- `evaluation/`: guarda as perguntas de verificação da base (`questions.json`, usadas por `pnpm rag:check`).

Atenção: a base atual é FICTÍCIA (Revenda Chama Azul, Teresina) e serve apenas para testes. Nenhuma informação dela é real.

Como usar: edite os arquivos de `base/` e rode `pnpm kb:ingest` para reindexar (com `LLM_API_KEY` os vetores são reais; sem ela, fake). Depois, `pnpm rag:check` mede as respostas contra `evaluation/questions.json` (só em dev). Detalhes em [knowledge.md](../docs/guides/modules/knowledge.md).
