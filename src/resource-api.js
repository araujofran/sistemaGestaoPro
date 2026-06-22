const crypto = require('node:crypto');
const { runAutomationRules } = require('./automation-engine');

function createResourceApi({ storage, parseBody, json }) {
  const editable = account => account.roleId !== 'viewer';
  const id = prefix => `${prefix}_${crypto.randomUUID()}`;
  const clean = value => String(value || '').trim();

  function expectedVersion(req, body, state) {
    const header = req.headers['if-match'] || req.headers['x-state-version'];
    const raw = header ? String(header).replace(/\"/g, '') : body.version;
    return raw === undefined ? Number(state.meta.version) : Number(raw);
  }

  async function save(req, body, state, account, action, entityType, entityId) {
    state.currentUser = account.memberId;
    state.activity = Array.isArray(state.activity) ? state.activity : [];
    state.activity.unshift({ id: id('activity'), user: account.memberId, text: action, date: new Date().toISOString() });
    const saved = await storage.saveState(state, expectedVersion(req, body, state));
    return { saved, audit: { action, entityType, entityId } };
  }

  function projectPayload(input, current = {}) {
    const type = input.type ?? current.type ?? 'kanban';
    if (!['scrum', 'kanban', 'hybrid'].includes(type)) throw Object.assign(new Error('Tipo de projeto inválido.'), { statusCode: 400 });
    const name = clean(input.name ?? current.name);
    const key = clean(input.key ?? current.key).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (!name || !key) throw Object.assign(new Error('Nome e chave do projeto são obrigatórios.'), { statusCode: 400 });
    return { ...current, ...input, name, key, type, description: clean(input.description ?? current.description), management: input.management ?? current.management ?? 'team', archived: Boolean(input.archived ?? current.archived), color: input.color ?? current.color ?? '#6757d9' };
  }

  function issuePayload(input, current = {}) {
    const title = clean(input.title ?? current.title);
    const projectId = input.projectId ?? current.projectId;
    if (!title || !projectId) throw Object.assign(new Error('Título e projeto são obrigatórios.'), { statusCode: 400 });
    return { ...current, ...input, title, projectId, description: clean(input.description ?? current.description), type: input.type ?? current.type ?? 'task', priority: input.priority ?? current.priority ?? 'medium', status: input.status ?? current.status ?? 'todo', labels: Array.isArray(input.labels) ? input.labels.map(clean).filter(Boolean) : (current.labels || []), updated: new Date().toISOString() };
  }

  return async function handle(req, res, url, account) {
    const projectRoute = url.pathname.match(/^\/api\/projects(?:\/([^/]+))?$/);
    if (projectRoute) {
      const state = await storage.getState();
      const projectId = projectRoute[1] ? decodeURIComponent(projectRoute[1]) : null;
      if (req.method === 'GET') {
        if (projectId) {
          const project = state.projects.find(item => item.id === projectId);
          return project ? json(res, 200, { project, version: state.meta.version }) : json(res, 404, { error: 'Projeto não encontrado.' });
        }
        const archived = url.searchParams.get('archived');
        const projects = archived === null ? state.projects : state.projects.filter(item => item.archived === (archived === 'true'));
        return json(res, 200, { projects, version: state.meta.version });
      }
      if (!editable(account)) return json(res, 403, { error: 'Seu perfil possui acesso somente para leitura.' });
      const body = await parseBody(req);
      if (req.method === 'POST' && !projectId) {
        const project = projectPayload(body);
        if (state.projects.some(item => item.key === project.key)) return json(res, 409, { error: 'Já existe um projeto com essa chave.' });
        project.id = id('project');
        state.projects.push(project);
        const { saved } = await save(req, body, state, account, `criou o projeto ${project.name}`, 'project', project.id);
        return json(res, 201, { project, version: saved.meta.version });
      }
      const index = state.projects.findIndex(item => item.id === projectId);
      if (index < 0) return json(res, 404, { error: 'Projeto não encontrado.' });
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const project = projectPayload(body, state.projects[index]);
        if (state.projects.some((item, itemIndex) => itemIndex !== index && item.key === project.key)) return json(res, 409, { error: 'Já existe um projeto com essa chave.' });
        state.projects[index] = project;
        const { saved } = await save(req, body, state, account, `atualizou o projeto ${project.name}`, 'project', project.id);
        return json(res, 200, { project, version: saved.meta.version });
      }
      if (req.method === 'DELETE') {
        const permanent = url.searchParams.get('permanent') === 'true';
        if (permanent && account.roleId !== 'admin') return json(res, 403, { error: 'Exclusão permanente é restrita a administradores.' });
        const project = state.projects[index];
        if (permanent) {
          state.projects.splice(index, 1);
          state.issues = state.issues.filter(issue => issue.projectId !== project.id);
          state.sprints = state.sprints.filter(sprint => sprint.projectId !== project.id);
          state.releases = state.releases.filter(release => release.projectId !== project.id);
        } else state.projects[index].archived = true;
        const { saved } = await save(req, body, state, account, `${permanent ? 'excluiu' : 'arquivou'} o projeto ${project.name}`, 'project', project.id);
        return json(res, 200, { ok: true, archived: !permanent, version: saved.meta.version });
      }
    }

    const issueRoute = url.pathname.match(/^\/api\/issues(?:\/([^/]+))?$/);
    if (issueRoute) {
      const state = await storage.getState();
      const issueId = issueRoute[1] ? decodeURIComponent(issueRoute[1]) : null;
      if (req.method === 'GET') {
        if (issueId) {
          const issue = state.issues.find(item => item.id === issueId || item.key === issueId);
          return issue ? json(res, 200, { issue, version: state.meta.version }) : json(res, 404, { error: 'Tarefa não encontrada.' });
        }
        let issues = state.issues;
        for (const field of ['projectId', 'status', 'assignee', 'type', 'priority']) {
          const value = url.searchParams.get(field);
          if (value) issues = issues.filter(item => String(item[field] || '') === value);
        }
        const query = clean(url.searchParams.get('q')).toLocaleLowerCase('pt-BR');
        if (query) issues = issues.filter(item => `${item.key} ${item.title} ${item.description}`.toLocaleLowerCase('pt-BR').includes(query));
        return json(res, 200, { issues, version: state.meta.version });
      }
      if (!editable(account)) return json(res, 403, { error: 'Seu perfil possui acesso somente para leitura.' });
      const body = await parseBody(req);
      if (req.method === 'POST' && !issueId) {
        const issue = issuePayload(body);
        const project = state.projects.find(item => item.id === issue.projectId);
        if (!project) return json(res, 400, { error: 'Projeto inválido.' });
        const sequence = Math.max(0, ...state.issues.filter(item => item.projectId === project.id).map(item => Number(String(item.key).split('-').pop()) || 0)) + 1;
        Object.assign(issue, { id: id('issue'), key: `${project.key}-${sequence}`, reporter: account.memberId, created: new Date().toISOString(), order: state.issues.length + 1, comments: [], worklogs: [] });
        state.issues.push(issue);
        runAutomationRules(state, { type: 'issue.created', issue }, account.memberId);
        const { saved } = await save(req, body, state, account, `criou ${issue.key}`, 'issue', issue.id);
        return json(res, 201, { issue, version: saved.meta.version });
      }
      const index = state.issues.findIndex(item => item.id === issueId || item.key === issueId);
      if (index < 0) return json(res, 404, { error: 'Tarefa não encontrada.' });
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const issue = issuePayload(body, state.issues[index]);
        if (!state.projects.some(item => item.id === issue.projectId)) return json(res, 400, { error: 'Projeto inválido.' });
        state.issues[index] = issue;
        runAutomationRules(state, { type: 'issue.updated', issue }, account.memberId);
        const { saved } = await save(req, body, state, account, `atualizou ${issue.key}`, 'issue', issue.id);
        return json(res, 200, { issue, version: saved.meta.version });
      }
      if (req.method === 'DELETE') {
        const issue = state.issues[index];
        state.issues.splice(index, 1);
        const { saved } = await save(req, body, state, account, `excluiu ${issue.key}`, 'issue', issue.id);
        return json(res, 200, { ok: true, version: saved.meta.version });
      }
    }
    return false;
  };
}

module.exports = { createResourceApi };
