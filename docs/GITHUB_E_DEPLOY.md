# GitHub, webhook e implantação

## Integração

O módulo **DevOps** consulta commits, branches, Pull Requests e GitHub Actions do repositório definido em `GITHUB_REPOSITORY`. Repositórios públicos funcionam sem token; `GITHUB_TOKEN` aumenta o limite da API e permite consultar recursos privados quando o token possuir somente as permissões necessárias.

Commits que mencionam chaves como `ORB-142` são vinculados automaticamente à tarefa correspondente durante a sincronização.

## Webhook

1. Gere um segredo longo e salve-o como `GITHUB_WEBHOOK_SECRET` no ambiente do servidor.
2. No GitHub, abra **Settings → Webhooks → Add webhook**.
3. Use `https://SEU-DOMINIO/api/github/webhook` como Payload URL.
4. Selecione `application/json`, informe o mesmo segredo e habilite eventos de push, Pull Request e workflow run.
5. O Orbit rejeita payloads sem assinatura HMAC SHA-256 válida.

`localhost` não recebe webhooks externos. Configure o webhook somente depois que o sistema possuir um endereço HTTPS público.

## Produção com Docker

Copie `.env.example` para `.env` no servidor e substitua todos os valores sensíveis. Use chaves diferentes para `SESSION_SECRET`, `POSTGRES_PASSWORD`, `INTEGRATION_ENCRYPTION_KEY` e `GITHUB_WEBHOOK_SECRET`.

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Verifique `https://SEU-DOMINIO/api/health`. Em produção, coloque um proxy HTTPS como Caddy, Traefik ou Nginx na frente da porta 4173.

## CI/CD

O workflow `.github/workflows/ci.yml` executa verificação de sintaxe, testes, auditoria de dependências e build Docker em branches e PRs. Depois de uma alteração entrar em `main`, ele publica `ghcr.io/araujofran/sistemagestaopro:latest`.

A implantação em um provedor depende da conta e das credenciais escolhidas. Nenhuma credencial de nuvem deve ser gravada no repositório.
