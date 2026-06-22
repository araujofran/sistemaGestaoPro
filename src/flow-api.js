const crypto = require('node:crypto');
const { runAutomationRules } = require('./automation-engine');

function createFlowApi({ storage, parseBody, json }) {
  const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;
  const now = () => new Date().toISOString();
  const readOnly = (res, account) => {
    if (account.roleId !== 'viewer') return false;
    json(res, 403, { error: 'Seu perfil possui acesso somente para leitura.' });
    return true;
  };
  const expected = (req, body, state) => Number(String(req.headers['if-match'] || req.headers['x-state-version'] || body.version || state.meta.version).replace(/"/g, ''));

  async function save(req, body, state, account, text) {
    state.currentUser = account.memberId;
    state.activity = state.activity || [];
    state.activity.unshift({ id: makeId('activity'), user: account.memberId, text, date: now() });
    return storage.saveState(state, expected(req, body, state));
  }

  function statusData(input, current = {}, position = 0) {
    const name = String(input.name ?? current.name ?? '').trim();
    if (!name) throw Object.assign(new Error('O nome da coluna é obrigatório.'), { statusCode: 400 });
    const limit = Number(input.limit ?? current.limit ?? 0);
    if (!Number.isInteger(limit) || limit < 0) throw Object.assign(new Error('O limite WIP deve ser um número inteiro positivo ou zero.'), { statusCode: 400 });
    return { ...current, ...input, name, color: input.color ?? current.color ?? '#77808f', limit, position: Number(input.position ?? current.position ?? position) };
  }

  return async function handle(req, res, url, account) {
    const moveRoute = url.pathname.match(/^\/api\/issues\/([^/]+)\/move$/);
    if (moveRoute && req.method === 'POST') {
      if (readOnly(res, account)) return;
      const state = await storage.getState();
      const body = await parseBody(req);
      const issue = state.issues.find(item => item.id === decodeURIComponent(moveRoute[1]) || item.key === decodeURIComponent(moveRoute[1]));
      if (!issue) return json(res, 404, { error: 'Tarefa não encontrada.' });
      const target = state.statuses.find(item => item.id === body.status);
      if (!target) return json(res, 400, { error: 'Coluna de destino inválida.' });
      const targetCount = state.issues.filter(item => item.projectId === issue.projectId && item.status === target.id && item.id !== issue.id).length;
      if (target.limit > 0 && targetCount >= target.limit) return json(res, 409, { error: `A coluna ${target.name} atingiu o limite WIP de ${target.limit}.`, code: 'WIP_LIMIT_REACHED' });
      const previousStatus = issue.status;
      issue.status = target.id;
      issue.statusHistory = Array.isArray(issue.statusHistory) ? issue.statusHistory : [];
      issue.statusHistory.push({ from: previousStatus, to: target.id, at: now(), by: account.memberId });
      issue.updated = now();
      const siblings = state.issues.filter(item => item.projectId === issue.projectId && item.status === target.id && item.id !== issue.id).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      const index = body.beforeId ? Math.max(0, siblings.findIndex(item => item.id === body.beforeId)) : body.afterId ? siblings.findIndex(item => item.id === body.afterId) + 1 : siblings.length;
      siblings.splice(index < 0 ? siblings.length : index, 0, issue);
      siblings.forEach((item, itemIndex) => { item.order = (itemIndex + 1) * 1000; });
      runAutomationRules(state, { type: 'issue.moved', issue }, account.memberId);
      const saved = await save(req, body, state, account, `moveu ${issue.key} para ${target.name}`);
      return json(res, 200, { issue, column: { id: target.id, count: targetCount + 1, limit: target.limit }, version: saved.meta.version });
    }

    if (url.pathname === '/api/backlog' && req.method === 'GET') {
      const state = await storage.getState();
      let issues = state.issues.filter(item => !item.sprintId);
      for (const field of ['projectId', 'type', 'priority', 'assignee', 'epic']) {
        const value = url.searchParams.get(field);
        if (value) issues = issues.filter(item => String(item[field] || '') === value);
      }
      const query = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase('pt-BR');
      if (query) issues = issues.filter(item => `${item.key} ${item.title} ${item.description}`.toLocaleLowerCase('pt-BR').includes(query));
      issues.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      return json(res, 200, { issues, totalPoints: issues.reduce((sum, item) => sum + Number(item.points || 0), 0), version: state.meta.version });
    }

    if (url.pathname === '/api/backlog/rank' && req.method === 'POST') {
      if (readOnly(res, account)) return;
      const state = await storage.getState();
      const body = await parseBody(req);
      if (!Array.isArray(body.orderedIds) || !body.orderedIds.length) return json(res, 400, { error: 'Informe a ordem das tarefas.' });
      const unique = new Set(body.orderedIds);
      if (unique.size !== body.orderedIds.length) return json(res, 400, { error: 'A lista de ordenação contém itens repetidos.' });
      body.orderedIds.forEach((issueId, index) => {
        const issue = state.issues.find(item => item.id === issueId && (!body.projectId || item.projectId === body.projectId));
        if (!issue) throw Object.assign(new Error(`Tarefa ${issueId} não encontrada.`), { statusCode: 404 });
        issue.order = (index + 1) * 1000;
        issue.updated = now();
      });
      const saved = await save(req, body, state, account, 'reordenou o backlog');
      return json(res, 200, { orderedIds: body.orderedIds, version: saved.meta.version });
    }

    const statusRoute = url.pathname.match(/^\/api\/statuses(?:\/([^/]+))?$/);
    if (statusRoute) {
      const state = await storage.getState();
      const statusId = statusRoute[1] ? decodeURIComponent(statusRoute[1]) : null;
      if (req.method === 'GET') {
        if (statusId) {
          const status = state.statuses.find(item => item.id === statusId);
          return status ? json(res, 200, { status, version: state.meta.version }) : json(res, 404, { error: 'Coluna não encontrada.' });
        }
        return json(res, 200, { statuses: state.statuses.slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0)), version: state.meta.version });
      }
      if (readOnly(res, account)) return;
      const body = await parseBody(req);
      if (req.method === 'POST' && !statusId) {
        const status = statusData(body, {}, state.statuses.length);
        status.id = makeId('status');
        state.statuses.push(status);
        const saved = await save(req, body, state, account, `criou a coluna ${status.name}`);
        return json(res, 201, { status, version: saved.meta.version });
      }
      const index = state.statuses.findIndex(item => item.id === statusId);
      if (index < 0) return json(res, 404, { error: 'Coluna não encontrada.' });
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const status = statusData(body, state.statuses[index], index);
        state.statuses[index] = status;
        if (Array.isArray(body.orderedIds)) {
          body.orderedIds.forEach((id, position) => { const item = state.statuses.find(column => column.id === id); if (item) item.position = position; });
        }
        const saved = await save(req, body, state, account, `atualizou a coluna ${status.name}`);
        return json(res, 200, { status, version: saved.meta.version });
      }
      if (req.method === 'DELETE') {
        const replacement = body.moveTo && state.statuses.find(item => item.id === body.moveTo);
        const affected = state.issues.filter(item => item.status === statusId);
        if (affected.length && !replacement) return json(res, 409, { error: 'Escolha uma coluna de destino para as tarefas existentes.' });
        affected.forEach(issue => { issue.status = replacement.id; issue.statusHistory = [...(issue.statusHistory || []), { from: statusId, to: replacement.id, at: now(), by: account.memberId }]; });
        const [removed] = state.statuses.splice(index, 1);
        state.statuses.forEach((item, position) => { item.position = position; });
        const saved = await save(req, body, state, account, `excluiu a coluna ${removed.name}`);
        return json(res, 200, { ok: true, movedIssues: affected.length, version: saved.meta.version });
      }
    }

    const boardRoute = url.pathname.match(/^\/api\/boards\/([^/]+)\/config$/);
    if (boardRoute) {
      const state = await storage.getState();
      const projectId = decodeURIComponent(boardRoute[1]);
      if (!state.projects.some(item => item.id === projectId)) return json(res, 404, { error: 'Projeto não encontrado.' });
      state.boardConfigs = state.boardConfigs || {};
      const defaults = { visibility: 'shared', swimlaneBy: 'none', cardColorBy: 'priority', cardFields: ['type', 'priority', 'assignee', 'points'], quickFilters: [] };
      if (req.method === 'GET') return json(res, 200, { config: { ...defaults, ...(state.boardConfigs[projectId] || {}) }, version: state.meta.version });
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (readOnly(res, account)) return;
        const body = await parseBody(req);
        const allowedSwimlanes = ['none', 'assignee', 'epic', 'priority'];
        if (body.swimlaneBy && !allowedSwimlanes.includes(body.swimlaneBy)) return json(res, 400, { error: 'Swimlane inválida.' });
        state.boardConfigs[projectId] = { ...defaults, ...(state.boardConfigs[projectId] || {}), ...body, quickFilters: Array.isArray(body.quickFilters) ? body.quickFilters : (state.boardConfigs[projectId]?.quickFilters || []) };
        delete state.boardConfigs[projectId].version;
        const saved = await save(req, body, state, account, 'atualizou a configuração do board');
        return json(res, 200, { config: state.boardConfigs[projectId], version: saved.meta.version });
      }
    }

    if (url.pathname === '/api/reports/flow' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      const issues = state.issues.filter(item => !projectId || item.projectId === projectId);
      const statusCounts = Object.fromEntries(state.statuses.map(status => [status.id, issues.filter(issue => issue.status === status.id).length]));
      const done = issues.filter(issue => issue.status === 'done');
      const dayMs = 86_400_000;
      const leadTimes = done.map(issue => (new Date(issue.updated || now()) - new Date(issue.created || issue.updated || now())) / dayMs).filter(Number.isFinite);
      const cycleTimes = done.map(issue => {
        const started = (issue.statusHistory || []).find(event => ['progress', 'review'].includes(event.to))?.at || issue.created;
        return (new Date(issue.updated || now()) - new Date(started || issue.updated || now())) / dayMs;
      }).filter(Number.isFinite);
      const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : 0;
      return json(res, 200, {
        leadTimeDays: average(leadTimes), cycleTimeDays: average(cycleTimes), throughput: done.length,
        wip: Object.entries(statusCounts).filter(([key]) => !['todo', 'done'].includes(key)).reduce((sum, [, count]) => sum + count, 0),
        cumulativeFlow: state.statuses.map(status => ({ statusId: status.id, name: status.name, count: statusCounts[status.id], limit: status.limit || 0 })),
        historyTracked: issues.filter(issue => issue.statusHistory?.length).length,
      });
    }
    return false;
  };
}

module.exports = { createFlowApi };
