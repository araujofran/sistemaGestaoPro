const crypto = require('node:crypto');

function createPlanningApi({ storage, parseBody, json }) {
  const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;
  const readOnly = (res, account) => {
    if (account.roleId !== 'viewer') return false;
    json(res, 403, { error: 'Seu perfil possui acesso somente para leitura.' });
    return true;
  };
  const expected = (req, body, state) => Number(String(req.headers['if-match'] || req.headers['x-state-version'] || body.version || state.meta.version).replace(/"/g, ''));

  async function save(req, body, state, account, text) {
    state.currentUser = account.memberId;
    state.activity = state.activity || [];
    state.activity.unshift({ id: makeId('activity'), user: account.memberId, text, date: new Date().toISOString() });
    return storage.saveState(state, expected(req, body, state));
  }

  function milestoneData(input, current = {}) {
    const name = String(input.name ?? current.name ?? '').trim();
    const projectId = input.projectId ?? current.projectId;
    const date = input.date ?? current.date;
    if (!name || !projectId || !date) throw Object.assign(new Error('Nome, projeto e data do marco são obrigatórios.'), { statusCode: 400 });
    const status = input.status ?? current.status ?? 'planned';
    if (!['planned', 'at-risk', 'completed', 'cancelled'].includes(status)) throw Object.assign(new Error('Status de marco inválido.'), { statusCode: 400 });
    return { ...current, ...input, name, projectId, date, status, description: String(input.description ?? current.description ?? '').trim() };
  }

  function createsCycle(dependencies, sourceId, targetId) {
    const graph = new Map();
    for (const dependency of dependencies) {
      if (!graph.has(dependency.sourceId)) graph.set(dependency.sourceId, []);
      graph.get(dependency.sourceId).push(dependency.targetId);
    }
    if (!graph.has(sourceId)) graph.set(sourceId, []);
    graph.get(sourceId).push(targetId);
    const seen = new Set();
    const visit = node => {
      if (node === sourceId && seen.size) return true;
      if (seen.has(node)) return false;
      seen.add(node);
      return (graph.get(node) || []).some(visit);
    };
    return visit(targetId);
  }

  return async function handle(req, res, url, account) {
    const milestoneRoute = url.pathname.match(/^\/api\/milestones(?:\/([^/]+))?$/);
    if (milestoneRoute) {
      const state = await storage.getState();
      state.milestones = state.milestones || [];
      const milestoneId = milestoneRoute[1] ? decodeURIComponent(milestoneRoute[1]) : null;
      if (req.method === 'GET') {
        if (milestoneId) {
          const milestone = state.milestones.find(item => item.id === milestoneId);
          return milestone ? json(res, 200, { milestone, version: state.meta.version }) : json(res, 404, { error: 'Marco não encontrado.' });
        }
        const projectId = url.searchParams.get('projectId');
        const milestones = (projectId ? state.milestones.filter(item => item.projectId === projectId) : state.milestones).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return json(res, 200, { milestones, version: state.meta.version });
      }
      if (readOnly(res, account)) return;
      const body = await parseBody(req);
      if (req.method === 'POST' && !milestoneId) {
        const milestone = milestoneData(body);
        if (!state.projects.some(item => item.id === milestone.projectId)) return json(res, 400, { error: 'Projeto inválido.' });
        milestone.id = makeId('milestone');
        state.milestones.push(milestone);
        const saved = await save(req, body, state, account, `criou o marco ${milestone.name}`);
        return json(res, 201, { milestone, version: saved.meta.version });
      }
      const index = state.milestones.findIndex(item => item.id === milestoneId);
      if (index < 0) return json(res, 404, { error: 'Marco não encontrado.' });
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const milestone = milestoneData(body, state.milestones[index]);
        state.milestones[index] = milestone;
        const saved = await save(req, body, state, account, `atualizou o marco ${milestone.name}`);
        return json(res, 200, { milestone, version: saved.meta.version });
      }
      if (req.method === 'DELETE') {
        const [milestone] = state.milestones.splice(index, 1);
        const saved = await save(req, body, state, account, `excluiu o marco ${milestone.name}`);
        return json(res, 200, { ok: true, version: saved.meta.version });
      }
    }

    const dependencyRoute = url.pathname.match(/^\/api\/dependencies(?:\/([^/]+))?$/);
    if (dependencyRoute) {
      const state = await storage.getState();
      state.dependencies = state.dependencies || [];
      const dependencyId = dependencyRoute[1] ? decodeURIComponent(dependencyRoute[1]) : null;
      if (req.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const issueIds = new Set(state.issues.filter(issue => !projectId || issue.projectId === projectId).map(issue => issue.id));
        const dependencies = projectId ? state.dependencies.filter(item => issueIds.has(item.sourceId) || issueIds.has(item.targetId)) : state.dependencies;
        return json(res, 200, { dependencies, version: state.meta.version });
      }
      if (readOnly(res, account)) return;
      const body = await parseBody(req);
      if (req.method === 'POST' && !dependencyId) {
        const sourceId = body.sourceId;
        const targetId = body.targetId;
        if (!sourceId || !targetId || sourceId === targetId) return json(res, 400, { error: 'Origem e destino devem ser tarefas diferentes.' });
        if (!state.issues.some(item => item.id === sourceId) || !state.issues.some(item => item.id === targetId)) return json(res, 404, { error: 'Uma das tarefas não foi encontrada.' });
        if (state.dependencies.some(item => item.sourceId === sourceId && item.targetId === targetId)) return json(res, 409, { error: 'Essa dependência já existe.' });
        if (createsCycle(state.dependencies, sourceId, targetId)) return json(res, 409, { error: 'A dependência criaria um ciclo no cronograma.', code: 'DEPENDENCY_CYCLE' });
        const dependency = { id: makeId('dependency'), sourceId, targetId, type: body.type || 'blocks', createdAt: new Date().toISOString() };
        state.dependencies.push(dependency);
        const saved = await save(req, body, state, account, 'vinculou tarefas no roadmap');
        return json(res, 201, { dependency, version: saved.meta.version });
      }
      if (req.method === 'DELETE' && dependencyId) {
        const index = state.dependencies.findIndex(item => item.id === dependencyId);
        if (index < 0) return json(res, 404, { error: 'Dependência não encontrada.' });
        state.dependencies.splice(index, 1);
        const saved = await save(req, body, state, account, 'removeu uma dependência do roadmap');
        return json(res, 200, { ok: true, version: saved.meta.version });
      }
    }

    if (url.pathname === '/api/roadmap' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      const projects = state.projects.filter(project => !project.archived && (!projectId || project.id === projectId));
      const projectIds = new Set(projects.map(project => project.id));
      const issues = state.issues.filter(issue => projectIds.has(issue.projectId));
      const issueIds = new Set(issues.map(issue => issue.id));
      return json(res, 200, {
        projects,
        items: issues.map(issue => ({ id: issue.id, key: issue.key, projectId: issue.projectId, title: issue.title, epic: issue.epic || '', status: issue.status, start: issue.start || issue.created || null, end: issue.due || null, points: Number(issue.points || 0) })),
        milestones: (state.milestones || []).filter(item => projectIds.has(item.projectId)),
        releases: state.releases.filter(item => projectIds.has(item.projectId)),
        dependencies: (state.dependencies || []).filter(item => issueIds.has(item.sourceId) && issueIds.has(item.targetId)),
        version: state.meta.version,
      });
    }

    if (url.pathname === '/api/forecast' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      if (!projectId) return json(res, 400, { error: 'Informe o projeto para gerar o forecast.' });
      const completedSprints = state.sprints.filter(item => item.projectId === projectId && item.status === 'completed' && Number(item.completedPoints || 0) > 0);
      const averageVelocity = completedSprints.length ? completedSprints.reduce((sum, item) => sum + Number(item.completedPoints), 0) / completedSprints.length : 0;
      const remainingPoints = state.issues.filter(item => item.projectId === projectId && item.status !== 'done').reduce((sum, item) => sum + Number(item.points || 0), 0);
      const projectedSprints = averageVelocity > 0 ? Math.ceil(remainingPoints / averageVelocity) : null;
      const sprintLengths = completedSprints.map(item => item.start && item.end ? Math.max(1, Math.round((new Date(item.end) - new Date(item.start)) / 86_400_000)) : 14);
      const averageSprintDays = sprintLengths.length ? Math.round(sprintLengths.reduce((sum, days) => sum + days, 0) / sprintLengths.length) : 14;
      const projectedDate = projectedSprints === null ? null : new Date(Date.now() + projectedSprints * averageSprintDays * 86_400_000).toISOString().slice(0, 10);
      const confidence = completedSprints.length >= 5 ? 'high' : completedSprints.length >= 2 ? 'medium' : 'low';
      return json(res, 200, { projectId, remainingPoints, averageVelocity: Math.round(averageVelocity * 100) / 100, projectedSprints, averageSprintDays, projectedDate, confidence, samples: completedSprints.length });
    }
    return false;
  };
}

module.exports = { createPlanningApi };
