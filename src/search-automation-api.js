const crypto = require('node:crypto');
const { runAutomationRules } = require('./automation-engine');

function createSearchAutomationApi({ storage, parseBody, json }) {
  const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;
  const readOnly = (res, account) => { if (account.roleId !== 'viewer') return false; json(res, 403, { error: 'Seu perfil possui acesso somente para leitura.' }); return true; };
  const expected = (req, body, state) => Number(String(req.headers['if-match'] || req.headers['x-state-version'] || body.version || state.meta.version).replace(/"/g, ''));
  async function save(req, body, state, account, text) { state.currentUser = account.memberId; state.activity = state.activity || []; state.activity.unshift({ id: makeId('activity'), user: account.memberId, text, date: new Date().toISOString() }); return storage.saveState(state, expected(req, body, state)); }

  const fields = { project: 'projectId', projectId: 'projectId', status: 'status', priority: 'priority', type: 'type', assignee: 'assignee', reporter: 'reporter', sprint: 'sprintId', sprintId: 'sprintId', epic: 'epic', key: 'key', points: 'points', title: 'title' };
  function parseValue(value) { const trimmed = value.trim(); return trimmed.replace(/^(["'])(.*)\1$/, '$2'); }
  function advancedSearch(issues, query) {
    if (!String(query || '').trim()) return issues;
    const clauses = String(query).split(/\s+AND\s+/i);
    return issues.filter(issue => clauses.every(clause => {
      const inMatch = clause.match(/^([\w]+)\s+IN\s*\(([^)]+)\)$/i);
      if (inMatch) { const field = fields[inMatch[1]]; if (!field) throw Object.assign(new Error(`Campo de busca inválido: ${inMatch[1]}`), { statusCode: 400 }); const values = inMatch[2].split(',').map(parseValue); return values.includes(String(issue[field] ?? '')); }
      const match = clause.match(/^([\w]+)\s*(=|!=|~|>=|<=|>|<)\s*(.+)$/);
      if (!match) throw Object.assign(new Error(`Cláusula inválida: ${clause}`), { statusCode: 400 });
      const field = fields[match[1]]; if (!field) throw Object.assign(new Error(`Campo de busca inválido: ${match[1]}`), { statusCode: 400 });
      const actual = issue[field]; const value = parseValue(match[3]);
      if (match[2] === '=') return String(actual ?? '') === value;
      if (match[2] === '!=') return String(actual ?? '') !== value;
      if (match[2] === '~') return String(actual ?? '').toLowerCase().includes(value.toLowerCase());
      if (match[2] === '>') return Number(actual || 0) > Number(value);
      if (match[2] === '<') return Number(actual || 0) < Number(value);
      if (match[2] === '>=') return Number(actual || 0) >= Number(value);
      return Number(actual || 0) <= Number(value);
    }));
  }

  return async function handle(req, res, url, account) {
    if ((url.pathname === '/api/search' || url.pathname === '/api/search/advanced') && req.method === 'GET') {
      const state = await storage.getState();
      const query = url.searchParams.get('q') || '';
      let issues;
      if (url.pathname.endsWith('/advanced')) issues = advancedSearch(state.issues, query);
      else { const text = query.trim().toLowerCase(); issues = text ? state.issues.filter(issue => `${issue.key} ${issue.title} ${issue.description} ${(issue.labels || []).join(' ')}`.toLowerCase().includes(text)) : state.issues; }
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
      return json(res, 200, { issues: issues.slice(0, limit), total: issues.length, query });
    }

    const filterSubscription = url.pathname.match(/^\/api\/filters\/([^/]+)\/subscribe$/);
    if (filterSubscription && (req.method === 'POST' || req.method === 'DELETE')) {
      const state = await storage.getState(); state.savedFilters = state.savedFilters || [];
      const filter = state.savedFilters.find(item => item.id === decodeURIComponent(filterSubscription[1]));
      if (!filter || (filter.visibility !== 'shared' && filter.ownerId !== account.memberId)) return json(res, 404, { error: 'Filtro não encontrado.' });
      filter.subscribers = filter.subscribers || [];
      if (req.method === 'POST') filter.subscribers = [...new Set([...filter.subscribers, account.memberId])]; else filter.subscribers = filter.subscribers.filter(id => id !== account.memberId);
      const saved = await save(req, {}, state, account, `${req.method === 'POST' ? 'assinou' : 'cancelou a assinatura de'} um filtro`);
      return json(res, 200, { filter, version: saved.meta.version });
    }

    const filterRoute = url.pathname.match(/^\/api\/filters(?:\/([^/]+))?$/);
    if (filterRoute) {
      const state = await storage.getState(); state.savedFilters = state.savedFilters || [];
      const filterId = filterRoute[1] ? decodeURIComponent(filterRoute[1]) : null;
      if (req.method === 'GET') return json(res, 200, { filters: state.savedFilters.filter(item => item.visibility === 'shared' || item.ownerId === account.memberId || account.roleId === 'admin'), version: state.meta.version });
      if (readOnly(res, account)) return;
      const body = await parseBody(req);
      if (req.method === 'POST' && !filterId) {
        const name = String(body.name || '').trim(); if (!name || !String(body.query || '').trim()) return json(res, 400, { error: 'Nome e consulta são obrigatórios.' });
        advancedSearch(state.issues, body.query);
        const filter = { id: makeId('filter'), name, query: body.query.trim(), ownerId: account.memberId, visibility: body.visibility === 'shared' ? 'shared' : 'private', subscribers: [], createdAt: new Date().toISOString() };
        state.savedFilters.push(filter); const saved = await save(req, body, state, account, `salvou o filtro ${name}`); return json(res, 201, { filter, version: saved.meta.version });
      }
      const index = state.savedFilters.findIndex(item => item.id === filterId); if (index < 0) return json(res, 404, { error: 'Filtro não encontrado.' });
      const filter = state.savedFilters[index]; if (filter.ownerId !== account.memberId && account.roleId !== 'admin') return json(res, 403, { error: 'Somente o proprietário pode alterar este filtro.' });
      if (req.method === 'PUT' || req.method === 'PATCH') { if (body.query) advancedSearch(state.issues, body.query); state.savedFilters[index] = { ...filter, ...body, id: filter.id, ownerId: filter.ownerId, subscribers: filter.subscribers }; delete state.savedFilters[index].version; const saved = await save(req, body, state, account, `atualizou o filtro ${state.savedFilters[index].name}`); return json(res, 200, { filter: state.savedFilters[index], version: saved.meta.version }); }
      if (req.method === 'DELETE') { state.savedFilters.splice(index, 1); const saved = await save(req, body, state, account, `excluiu o filtro ${filter.name}`); return json(res, 200, { ok: true, version: saved.meta.version }); }
    }

    const runRoute = url.pathname.match(/^\/api\/automations\/([^/]+)\/run$/);
    if (runRoute && req.method === 'POST') {
      if (readOnly(res, account)) return;
      const state = await storage.getState(); const body = await parseBody(req); state.automationRules = state.automationRules || [];
      const rule = state.automationRules.find(item => item.id === decodeURIComponent(runRoute[1])); if (!rule) return json(res, 404, { error: 'Automação não encontrada.' });
      const issue = state.issues.find(item => item.id === body.issueId || item.key === body.issueId); if (!issue) return json(res, 404, { error: 'Tarefa não encontrada.' });
      const originalTrigger = rule.trigger; rule.trigger = { type: 'manual' }; const runs = runAutomationRules(state, { type: 'manual', issue }, account.memberId); rule.trigger = originalTrigger;
      const saved = await save(req, body, state, account, `executou a automação ${rule.name}`); return json(res, 200, { runs, issue, version: saved.meta.version });
    }

    const automationRoute = url.pathname.match(/^\/api\/automations(?:\/([^/]+))?$/);
    if (automationRoute) {
      const state = await storage.getState(); state.automationRules = state.automationRules || []; state.automationRuns = state.automationRuns || [];
      const ruleId = automationRoute[1] ? decodeURIComponent(automationRoute[1]) : null;
      if (req.method === 'GET') return json(res, 200, { rules: state.automationRules, recentRuns: state.automationRuns.slice(0, 50), version: state.meta.version });
      if (account.roleId !== 'admin') return json(res, 403, { error: 'A gestão de automações é restrita a administradores.' });
      const body = await parseBody(req);
      if (req.method === 'POST' && !ruleId) {
        const name = String(body.name || '').trim(); if (!name || !body.trigger?.type || !Array.isArray(body.actions) || !body.actions.length) return json(res, 400, { error: 'Nome, gatilho e ações são obrigatórios.' });
        const rule = { id: makeId('automation'), name, description: String(body.description || ''), enabled: body.enabled !== false, trigger: body.trigger, conditions: Array.isArray(body.conditions) ? body.conditions : [], actions: body.actions, ownerId: account.memberId, runCount: 0, createdAt: new Date().toISOString() };
        state.automationRules.push(rule); const saved = await save(req, body, state, account, `criou a automação ${name}`); return json(res, 201, { rule, version: saved.meta.version });
      }
      const index = state.automationRules.findIndex(item => item.id === ruleId); if (index < 0) return json(res, 404, { error: 'Automação não encontrada.' });
      if (req.method === 'PUT' || req.method === 'PATCH') { state.automationRules[index] = { ...state.automationRules[index], ...body, id: ruleId }; delete state.automationRules[index].version; const saved = await save(req, body, state, account, `atualizou a automação ${state.automationRules[index].name}`); return json(res, 200, { rule: state.automationRules[index], version: saved.meta.version }); }
      if (req.method === 'DELETE') { const [rule] = state.automationRules.splice(index, 1); const saved = await save(req, body, state, account, `excluiu a automação ${rule.name}`); return json(res, 200, { ok: true, version: saved.meta.version }); }
    }
    return false;
  };
}

module.exports = { createSearchAutomationApi };
