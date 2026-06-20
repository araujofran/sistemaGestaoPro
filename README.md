# Orbit Projects

Sistema de gestão ágil de projetos inspirado nos principais fluxos do Jira, construído integralmente em JavaScript e sem dependências externas obrigatórias.

## Executar

```powershell
node server.js
```

Abra `http://localhost:4173`.

Para validar a sintaxe:

```powershell
node --check server.js
node --check public/app.js
```

## PostgreSQL

O sistema possui dois modos de persistência:

- `json`: compatibilidade local, sem configuração adicional.
- `postgres`: recomendado para uso simultâneo pela equipe.

Copie `.env.example` para `.env`, ajuste a `DATABASE_URL` e execute:

```powershell
npm run db:migrate
npm run db:import
npm start
```

O importador migra os dados atuais de `data/state.json`, incluindo projetos, pessoas, tarefas, sprints, releases, comentários, etiquetas, atividades e registros de horas. A importação é executada em uma transação e pode ser repetida com segurança.

Exemplo de configuração:

```dotenv
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://orbit_app:senha@localhost:5432/orbit_projects
DATABASE_SSL=false
```

Nunca envie o arquivo `.env` para o Git. Apenas `.env.example` deve permanecer versionado.

## Recursos implementados

- Dashboard executivo com indicadores, progresso, atividade e releases
- Múltiplos projetos Scrum/Kanban
- Quadro Kanban com drag-and-drop e limites WIP visíveis
- Backlog, sprints, metas, estimativas e priorização
- Tarefas, histórias, bugs e épicos
- Prioridade, responsável, prazo, etiquetas e story points
- Comentários, histórico de atividade e registro de horas
- Roadmap por épicos e acompanhamento de releases
- Relatórios de velocidade, fluxo e distribuição por pessoa
- Busca global e filtros por responsável e prioridade
- Equipe e configurações do workspace
- Persistência segura em arquivo JSON no servidor
- Layout responsivo para desktop, tablet e celular

## Arquitetura

O servidor usa apenas módulos nativos do Node.js. A interface é uma SPA em JavaScript, HTML e CSS. Os dados são gravados em `data/state.json`, criado automaticamente na primeira execução.

Esta versão cobre o núcleo operacional. SSO/SAML, integrações Git reais, notificações externas, automações configuráveis e recursos de infraestrutura corporativa exigem credenciais e serviços externos e não estão simulados na interface.
