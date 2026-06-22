# Configurar IA Gemini

O Orbit funciona em modo local sem chave. Para usar geração por IA externa:

1. Acesse o [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Entre com sua conta Google e crie uma API key.
3. Abra o arquivo `.env` local do projeto.
4. Adicione ou atualize:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=cole_a_chave_aqui
AI_MODEL=gemini-2.5-flash
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

5. Reinicie o servidor com `npm start`.
6. Abra **Integrações** no Orbit. O cartão deve mostrar “IA conectada”.

## Segurança

- O arquivo `.env` está ignorado pelo Git e não deve ser enviado ao GitHub.
- A chave nunca é enviada ao navegador.
- Somente os textos solicitados nas ações de IA são enviados ao provedor.
- Se a chave ou a cota falhar, o sistema volta automaticamente ao modo local.
- Limites e disponibilidade da faixa gratuita são definidos pelo provedor e podem mudar.

Documentação oficial: [Gemini API](https://ai.google.dev/gemini-api/docs) e [preços](https://ai.google.dev/gemini-api/docs/pricing).
