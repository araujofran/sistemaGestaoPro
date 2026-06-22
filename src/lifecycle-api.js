const crypto = require('node:crypto');

function createLifecycleApi({ storage, parseBody, json }) {
  const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const forbidden = (res, account) => {
    if (account.roleId !== 'viewer') return false;
    json(res, 403, { error: 'Seu perfil possui acesso somente para leitura.' });
    return true;
  };
  const version = (req, body, state) => Number(String(req.headers['if-match'] || req.headers['x-state-version'] || body.version || state.meta.version).replace(/"/g, ''));

  async function persist(req, body, state, account, text) {
    state.currentUser = account.memberId;
    state.activity = state.activity || [];
    state.activity.unshift({ id: makeId('activity'), user: account.memberId, text, date: new Date().toISOString() });
    return storage.saveState(state, version(req, body, state));
  }

  function sprintData(input, current = {}) {
    const name = String(input.name ?? current.name ?? '').trim();
    const projectId = input.projectId ?? current.projectId;
    if (!name || !projectId) throw Object.assign(new Error('Nome e projeto da sprint são obrigatórios.'), { statusCode: 400 });
    const capacity = Number(input.capacity ?? current.capacity ?? 0);
    if (!Number.isFinite(capacity) || capacity < 0) throw Object.assign(new Error('Capacidade inválida.'), { statusCode: 400 });
    return { ...current, ...input, name, projectId, goal: String(input.goal ?? current.goal ?? '').trim(), start: input.start ?? current.start ?? null, end: input.end ?? current.end ?? null, capacity, status: input.status ?? current.status ?? 'planned' };
  }

  function releaseData(input, current = {}) {
    const name = String(input.name ?? current.name ?? '').trim();
    const projectId = input.projectId ?? current.projectId;
    if (!name || !projectId) throw Object.assign(new Error('Nome e projeto da release são obrigatórios.'), { statusCode: 400 });
    const progress = Number(input.progress ?? current.progress ?? 0);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw Object.assign(new Error('Progresso deve estar entre 0 e 100.'), { statusCode: 400 });
    const status = input.status ?? current.status ?? 'planned';
    if (!['planned', 'in-progress', 'released', 'cancelled'].includes(status)) throw Object.assign(new Error('Status de release inválido.'), { statusCode: 400 });
    return { ...current, ...input, name, projectId, date: input.date ?? current.date ?? null, status, progress, notes: String(input.notes ?? current.notes ?? '').trim() };
  }

  return async function handle(req, res, url, account) {
    const sprintAction = url.pathname.match(/^\/api\/sprints\/([^/]+)\/(start|complete)$/);
    if (sprintAction && req.method === 'POST') {
      if (forbidden(res, account)) return;
      const state = await storage.getState();
      const body = await parseBody(req);
      const sprint = state.sprints.find(item => item.id === decodeURIComponent(sprintAction[1]));
      if (!sprint) return json(res, 404, { error: 'Sprint não encontrada.' });
      if (sprintAction[2] === 'start') {
        if (sprint.status !== 'planned') return json(res, 409, { error: 'Somente uma sprint planejada pode ser iniciada.' });
        if (state.sprints.some(item => item.projectId === sprint.projectId && item.status === 'active')) return json(res, 409, { error: 'O projeto já possui uma sprint ativa.' });
        sprint.status = 'active';
        sprint.start = sprint.start || today();
        const saved = await persist(req, body, state, account, `iniciou a sprint ${sprint.name}`);
        return json(res, 200, { sprint, version: saved.meta.version });
      }
      if (sprint.status !== 'active') return json(res, 409, { error: 'Somente a sprint ativa pode ser concluída.' });
      const targetId = body.moveIncompleteTo || null;
      if (targetId && !state.sprints.some(item => item.id === targetId && item.projectId === sprint.projectId && item.status === 'planned')) return json(res, 400, { error: 'A sprint de destino deve estar planejada e pertencer ao mesmo projeto.' });
      const sprintIssues = state.issues.filter(issue => issue.sprintId === sprint.id);
      const completed = sprintIssues.filter(issue => issue.status === 'done');
      const incomplete = sprintIssues.filter(issue => issue.status !== 'done');
      incomplete.forEach(issue => { issue.sprintId = targetId; issue.updated = new Date().toISOString(); });
      sprint.status = 'completed';
      sprint.end = today();
      sprint.completedPoints = completed.reduce((sum, issue) => sum + Number(issue.points || 0), 0);
      sprint.completedIssues = completed.length;
      const saved = await persist(req, body, state, account, `concluiu a sprint ${sprint.name}`);
      return json(res, 200, { sprint, summary: { completed: completed.length, incomplete: incomplete.length, completedPoints: sprint.completedPoints, movedTo: targetId }, version: saved.meta.version });
    }

    const sprintRoute = url.pathname.match(/^\/api\/sprints(?:\/([^/]+))?$/);
    if (sprintRoute) {
      const state = await storage.getState();
      const sprintId = sprintRoute[1] ? decodeURIComponent(sprintRoute[1]) : null;
      if (req.method === 'GET') {
        if (sprintId) {
          const sprint = state.sprints.find(item => item.id === sprintId);
          return sprint ? json(res, 200, { sprint, version: state.meta.version }) : json(res, 404, { error: 'Sprint não encontrada.' });
        }
        let sprints = state.sprints;
        const projectId = url.searchParams.get('projectId');
        const status = url.searchParams.get('status');
        if (projectId) sprints = sprints.filter(item => item.projectId === projectId);
        if (status) sprints = sprints.filter(item => item.status === status);
        return json(res, 200, { sprints, version: state.meta.version });
      }
      if (forbidden(res, account)) return;
      const body = await parseBody(req);
      if (req.method === 'POST' && !sprintId) {
        const sprint = sprintData(body);
        if (!state.projects.some(item => item.id === sprint.projectId)) return json(res, 400, { error: 'Projeto inválido.' });
        sprint.id = makeId('sprint');
        state.sprints.push(sprint);
        const saved = await persist(req, body, state, account, `planejou a sprint ${sprint.name}`);
        return json(res, 201, { sprint, version: saved.meta.version });
      }
      const index = state.sprints.findIndex(item => item.id === sprintId);
      if (index < 0) return json(res, 404, { error: 'Sprint não encontrada.' });
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (state.sprints[index].status === 'completed') return json(res, 409, { error: 'Uma sprint concluída não pode ser alterada.' });
        const sprint = sprintData(body, state.sprints[index]);
        state.sprints[index] = sprint;
        const saved = await persist(req, body, state, account, `atualizou a sprint ${sprint.name}`);
        return json(res, 200, { sprint, version: saved.meta.version });
      }
      if (req.method === 'DELETE') {
        if (state.sprints[index].status === 'active') return json(res, 409, { error: 'Conclua a sprint ativa antes de excluí-la.' });
        const sprint = state.sprints[index];
        state.issues.forEach(issue => { if (issue.sprintId === sprint.id) issue.sprintId = null; });
        state.sprints.splice(index, 1);
        const saved = await persist(req, body, state, account, `excluiu a sprint ${sprint.name}`);
        return json(res, 200, { ok: true, version: saved.meta.version });
      }
    }

    const releaseRoute = url.pathname.match(/^\/api\/releases(?:\/([^/]+))?$/);
    if (releaseRoute) {
      const state = await storage.getState();
      const releaseId = releaseRoute[1] ? decodeURIComponent(releaseRoute[1]) : null;
      if (req.method === 'GET') {
        if (releaseId) {
          const release = state.releases.find(item => item.id === releaseId);
          return release ? json(res, 200, { release, version: state.meta.version }) : json(res, 404, { error: 'Release não encontrada.' });
        }
        const projectId = url.searchParams.get('projectId');
        const releases = projectId ? state.releases.filter(item => item.projectId === projectId) : state.releases;
        return json(res, 200, { releases, version: state.meta.version });
      }
      if (forbidden(res, account)) return;
      const body = await parseBody(req);
      if (req.method === 'POST' && !releaseId) {
        const release = releaseData(body);
        if (!state.projects.some(item => item.id === release.projectId)) return json(res, 400, { error: 'Projeto inválido.' });
        release.id = makeId('release');
        state.releases.push(release);
        const saved = await persist(req, body, state, account, `criou a release ${release.name}`);
        return json(res, 201, { release, version: saved.meta.version });
      }
      const index = state.releases.findIndex(item => item.id === releaseId);
      if (index < 0) return json(res, 404, { error: 'Release não encontrada.' });
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const release = releaseData(body, state.releases[index]);
        state.releases[index] = release;
        const saved = await persist(req, body, state, account, `atualizou a release ${release.name}`);
        return json(res, 200, { release, version: saved.meta.version });
      }
      if (req.method === 'DELETE') {
        const release = state.releases[index];
        state.releases.splice(index, 1);
        const saved = await persist(req, body, state, account, `excluiu a release ${release.name}`);
        return json(res, 200, { ok: true, version: saved.meta.version });
      }
    }

    if (url.pathname === '/api/reports/velocity' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      const sprints = state.sprints.filter(item => item.status === 'completed' && (!projectId || item.projectId === projectId));
      const values = sprints.map(item => ({ sprintId: item.id, name: item.name, completedPoints: Number(item.completedPoints || 0), completedIssues: Number(item.completedIssues || 0), end: item.end }));
      const average = values.length ? values.reduce((sum, item) => sum + item.completedPoints, 0) / values.length : 0;
      return json(res, 200, { velocity: values, average: Math.round(average * 100) / 100 });
    }
    return false;
  };
}

module.exports = { createLifecycleApi };
