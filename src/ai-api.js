const crypto = require('node:crypto');
const config = require('./config');
const { generateText, generateJson } = require('./ai-provider');

function createAiApi({ storage, parseBody, json }) {
  const id = prefix => `${prefix}_${crypto.randomUUID()}`;
  const usage = new Map();
  const tokenize = text => [...new Set(String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{3,}/g) || [])];
  const sentence = text => String(text || '').trim().replace(/\s+/g, ' ').replace(/(^.|[.!?]\s+.)/g, value => value.toUpperCase());
  const clean = (text, max = 6000) => String(text || '').trim().slice(0, max);
  const issueBy = (state, value) => state.issues.find(item => item.id === value || item.key === value);
  const version = (req, body, state) => Number(String(req.headers['if-match'] || req.headers['x-state-version'] || body.version || state.meta.version).replace(/"/g, ''));
  const providerReady = () => config.aiProvider === 'gemini' && Boolean(config.aiApiKey);
  const mode = generated => ({ mode: generated ? 'provider' : 'local', fallback: providerReady() && !generated });
  const allow = account => {
    const key = account?.memberId || 'anonymous', now = Date.now(), recent = (usage.get(key) || []).filter(time => now - time < 60_000);
    if (recent.length >= 20) return false;
    recent.push(now); usage.set(key, recent); return true;
  };
  const localSummary = (state, issue) => {
    const spent = (issue.worklogs || []).reduce((sum, log) => sum + Number(log.minutes || 0), 0);
    return { summary: `${issue.key}: ${issue.title}. Status: ${issue.status}; prioridade: ${issue.priority}; responsável: ${state.members.find(member => member.id === issue.assignee)?.name || 'não definido'}; estimativa: ${Number(issue.points || 0)} pontos; tempo registrado: ${spent} minutos.`, risks: [issue.due && new Date(issue.due) < new Date() && issue.status !== 'done' ? 'Prazo vencido' : null, !issue.assignee ? 'Sem responsável' : null, !issue.description ? 'Descrição incompleta' : null].filter(Boolean) };
  };
  const localSubtasks = issue => [`Analisar requisitos de ${issue.title}`, `Implementar ${issue.title}`, `Criar testes para ${issue.title}`, `Documentar e validar ${issue.title}`];

  return async function handle(req, res, url, account) {
    if (url.pathname === '/api/ai/status' && req.method === 'GET') return json(res, 200, { provider: config.aiProvider, model: config.aiModel, configured: providerReady(), mode: providerReady() ? 'provider' : 'local', limitPerMinute: 20 });
    if (req.method !== 'POST') return false;
    if (!allow(account)) return json(res, 429, { error: 'Limite de 20 ações de IA por minuto atingido. Aguarde um pouco e tente novamente.' });
    const body = await parseBody(req); const state = await storage.getState();

    if (url.pathname === '/api/ai/task-summary') {
      const issue = issueBy(state, body.issueId); if (!issue) return json(res, 404, { error: 'Tarefa não encontrada.' });
      const local = localSummary(state, issue), generated = await generateJson(`Analise a tarefa de software e produza um resumo executivo curto e riscos objetivos. JSON: {"summary":"texto","risks":["risco"]}. Tarefa: ${clean(JSON.stringify({ key: issue.key, title: issue.title, description: issue.description, status: issue.status, priority: issue.priority, due: issue.due, comments: issue.comments }))}`);
      const valid = generated && typeof generated.summary === 'string';
      return json(res, 200, { ...(valid ? { summary: clean(generated.summary, 2000), risks: Array.isArray(generated.risks) ? generated.risks.map(item => clean(item, 300)).slice(0, 6) : [] } : local), ...mode(valid) });
    }
    if (url.pathname === '/api/ai/generate-description') {
      const title = sentence(body.title); if (!title) return json(res, 400, { error: 'Informe o título.' });
      const local = `Objetivo\n${title}.\n\nContexto\n${sentence(body.context || 'Esta entrega faz parte das prioridades atuais do projeto.')}\n\nCritérios de aceite\n- O comportamento esperado foi implementado.\n- Os cenários principais e de erro foram validados.\n- A documentação relevante foi atualizada.`;
      const generated = await generateText(`Escreva em português uma descrição objetiva de tarefa de software, com contexto e critérios de aceite. Título: ${clean(title, 300)}. Contexto: ${clean(body.context || 'não informado', 3000)}. Não use markdown complexo.`);
      return json(res, 200, { description: generated || local, ...mode(generated) });
    }
    if (url.pathname === '/api/ai/subtasks') {
      const issue = issueBy(state, body.issueId); if (!issue) return json(res, 404, { error: 'Tarefa não encontrada.' });
      const generated = await generateJson(`Divida a tarefa em 3 a 6 subtarefas pequenas, acionáveis e sem repetição. JSON: {"suggestions":["título"]}. Tarefa: ${clean(JSON.stringify({ title: issue.title, description: issue.description, type: issue.type }), 5000)}`);
      const suggestions = Array.isArray(generated?.suggestions) ? generated.suggestions.map(item => clean(item, 180)).filter(Boolean).slice(0, 8) : localSubtasks(issue);
      if (!body.create) return json(res, 200, { suggestions, ...mode(generated?.suggestions) });
      if (account.roleId === 'viewer') return json(res, 403, { error: 'Acesso somente leitura.' });
      const project = state.projects.find(item => item.id === issue.projectId), base = Math.max(0, ...state.issues.filter(item => item.projectId === issue.projectId).map(item => Number(String(item.key).split('-').pop()) || 0));
      const created = suggestions.map((title, index) => ({ id: id('issue'), key: `${project.key}-${base + index + 1}`, projectId: issue.projectId, parentId: issue.id, title, description: '', type: 'subtask', priority: issue.priority || 'medium', status: 'todo', assignee: issue.assignee || null, reporter: account.memberId, sprintId: issue.sprintId || null, points: 0, labels: ['ai-assisted'], created: new Date().toISOString(), updated: new Date().toISOString(), order: state.issues.length + index + 1, comments: [], worklogs: [] }));
      state.issues.push(...created); state.currentUser = account.memberId; const saved = await storage.saveState(state, version(req, body, state));
      return json(res, 201, { subtasks: created, version: saved.meta.version, ...mode(generated?.suggestions) });
    }
    if (url.pathname === '/api/ai/automation-suggestion') {
      const issue = issueBy(state, body.issueId); if (!issue) return json(res, 404, { error: 'Tarefa não encontrada.' });
      const generated = await generateJson(`Sugira até 3 automações úteis para a tarefa. JSON: {"suggestions":[{"name":"nome","reason":"motivo","label":"etiqueta"}]}. Tarefa: ${clean(JSON.stringify({ title: issue.title, description: issue.description, priority: issue.priority, status: issue.status, assignee: issue.assignee }), 5000)}`);
      let suggestions = Array.isArray(generated?.suggestions) ? generated.suggestions.slice(0, 3).map(item => ({ name: clean(item.name, 160), reason: clean(item.reason, 400), trigger: { type: 'issue.updated' }, conditions: [], actions: [{ type: 'add-label', value: clean(item.label || 'ai-suggested', 60) }] })).filter(item => item.name) : [];
      if (!suggestions.length && (issue.priority === 'highest' || issue.priority === 'high')) suggestions.push({ name: 'Escalonar trabalho prioritário', reason: 'A tarefa possui prioridade elevada.', trigger: { type: 'issue.created' }, conditions: [{ field: 'priority', operator: 'contains', value: 'high' }], actions: [{ type: 'add-label', value: 'expedite' }] });
      if (!suggestions.length && !issue.assignee) suggestions.push({ name: 'Atribuir itens sem responsável', reason: 'A tarefa ainda não possui responsável.', trigger: { type: 'issue.created' }, conditions: [{ field: 'assignee', operator: 'is-empty' }], actions: [{ type: 'add-label', value: 'needs-owner' }] });
      return json(res, 200, { suggestions, ...mode(generated?.suggestions) });
    }
    if (url.pathname === '/api/ai/smart-search') {
      const query = clean(body.query, 500), queryTokens = tokenize(query), candidates = state.issues.slice(0, 50);
      const lexical = candidates.map(issue => { const tokens = tokenize(`${issue.key} ${issue.title} ${issue.description} ${(issue.labels || []).join(' ')} ${issue.epic || ''}`); return { issue, score: queryTokens.reduce((sum, token) => sum + (tokens.some(value => value.includes(token) || token.includes(value)) ? 1 : 0), 0) }; }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
      const generated = await generateJson(`Selecione e ordene os IDs das tarefas mais relacionadas à consulta. JSON: {"ids":["id"]}. Consulta: ${query}. Tarefas: ${clean(JSON.stringify(candidates.map(issue => ({ id: issue.id, key: issue.key, title: issue.title, description: issue.description, labels: issue.labels }))), 12000)}`);
      const ranked = Array.isArray(generated?.ids) ? generated.ids.map(value => candidates.find(issue => issue.id === value)).filter(Boolean).slice(0, Math.min(20, Number(body.limit || 20))).map((issue, index) => ({ issue, score: 100 - index })) : lexical.slice(0, Math.min(50, Number(body.limit || 20)));
      return json(res, 200, { results: ranked, ...mode(generated?.ids) });
    }
    if (url.pathname === '/api/ai/comments-summary') {
      const issue = issueBy(state, body.issueId); if (!issue) return json(res, 404, { error: 'Tarefa não encontrada.' }); const comments = issue.comments || [];
      const authors = [...new Set(comments.map(comment => state.members.find(member => member.id === comment.author)?.name || comment.author))], recent = comments.slice(-3).map(comment => sentence(comment.text));
      const local = comments.length ? `${comments.length} comentário(s), com participação de ${authors.join(', ')}. Pontos recentes: ${recent.join(' | ')}` : 'Ainda não há comentários para resumir.';
      const generated = comments.length ? await generateText(`Resuma em português as decisões, pendências e divergências destes comentários, sem inventar informações: ${clean(JSON.stringify(comments.map(comment => ({ author: state.members.find(member => member.id === comment.author)?.name, text: comment.text }))), 8000)}`) : null;
      return json(res, 200, { summary: generated || local, commentCount: comments.length, ...mode(generated) });
    }
    if (url.pathname === '/api/ai/writing-assistant') {
      const text = sentence(body.text); if (!text) return json(res, 400, { error: 'Informe o texto.' }); let rewritten = text;
      if (body.tone === 'concise') rewritten = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '); if (body.tone === 'formal') rewritten = sentence(rewritten.replace(/\bvc\b/gi, 'você').replace(/\bpra\b/gi, 'para'));
      const generated = await generateText(`Reescreva o texto em português com tom ${body.tone || 'claro'}, preservando o sentido e sem explicações adicionais: ${clean(text, 6000)}`);
      return json(res, 200, { text: generated || rewritten, tone: body.tone || 'clear', ...mode(generated) });
    }
    return false;
  };
}

module.exports = { createAiApi };
