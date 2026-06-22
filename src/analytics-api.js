const crypto = require('node:crypto');

function createAnalyticsApi({ storage, parseBody, json }) {
  const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;
  const readOnly = (res, account) => {
    if (account.roleId !== 'viewer') return false;
    json(res, 403, { error: 'Seu perfil possui acesso somente para leitura.' });
    return true;
  };
  const expected = (req, body, state) => Number(String(req.headers['if-match'] || req.headers['x-state-version'] || body.version || state.meta.version).replace(/"/g, ''));
  const day = 86_400_000;
  const dateOnly = value => new Date(value).toISOString().slice(0, 10);

  async function save(req, body, state, account, text) {
    state.currentUser = account.memberId;
    state.activity = state.activity || [];
    state.activity.unshift({ id: makeId('activity'), user: account.memberId, text, date: new Date().toISOString() });
    return storage.saveState(state, expected(req, body, state));
  }

  function sprintChart(state, sprintId) {
    const sprint = state.sprints.find(item => item.id === sprintId);
    if (!sprint) throw Object.assign(new Error('Sprint não encontrada.'), { statusCode: 404 });
    const issues = state.issues.filter(issue => issue.sprintId === sprintId || (sprint.status === 'completed' && issue.completedSprintId === sprintId));
    const start = new Date(sprint.start || Date.now());
    const end = new Date(sprint.end || start.getTime() + 13 * day);
    const days = Math.max(1, Math.round((end - start) / day) + 1);
    const total = issues.reduce((sum, issue) => sum + Number(issue.points || 0), 0);
    const timeline = Array.from({ length: days }, (_, index) => {
      const current = new Date(start.getTime() + index * day);
      const completed = issues.filter(issue => issue.status === 'done' && new Date(issue.updated || end) <= new Date(current.getTime() + day - 1)).reduce((sum, issue) => sum + Number(issue.points || 0), 0);
      return { date: dateOnly(current), idealRemaining: Math.round((total - total * index / Math.max(1, days - 1)) * 100) / 100, actualRemaining: total - completed, completed, scope: total };
    });
    return { sprint, issues, total, timeline };
  }

  return async function handle(req, res, url, account) {
    if (url.pathname === '/api/reports/burndown' && req.method === 'GET') {
      const state = await storage.getState();
      const chart = sprintChart(state, url.searchParams.get('sprintId'));
      return json(res, 200, { sprint: chart.sprint, totalPoints: chart.total, burndown: chart.timeline.map(item => ({ date: item.date, ideal: item.idealRemaining, actual: item.actualRemaining })) });
    }
    if (url.pathname === '/api/reports/burnup' && req.method === 'GET') {
      const state = await storage.getState();
      const chart = sprintChart(state, url.searchParams.get('sprintId'));
      return json(res, 200, { sprint: chart.sprint, burnup: chart.timeline.map(item => ({ date: item.date, completed: item.completed, scope: item.scope })) });
    }
    if (url.pathname === '/api/reports/sprint' && req.method === 'GET') {
      const state = await storage.getState();
      const chart = sprintChart(state, url.searchParams.get('sprintId'));
      const group = status => chart.issues.filter(issue => status.includes(issue.status));
      const completed = group(['done']);
      const incomplete = chart.issues.filter(issue => issue.status !== 'done');
      return json(res, 200, { sprint: chart.sprint, committedPoints: chart.total, completedPoints: completed.reduce((sum, issue) => sum + Number(issue.points || 0), 0), completed, incomplete, completionRate: chart.total ? Math.round(completed.reduce((sum, issue) => sum + Number(issue.points || 0), 0) / chart.total * 100) : 0 });
    }
    if (url.pathname === '/api/reports/epics' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      const issues = state.issues.filter(issue => !projectId || issue.projectId === projectId);
      const names = [...new Set(issues.map(issue => issue.epic || 'Sem épico'))];
      const epics = names.map(name => {
        const items = issues.filter(issue => (issue.epic || 'Sem épico') === name);
        const points = items.reduce((sum, issue) => sum + Number(issue.points || 0), 0);
        const completedPoints = items.filter(issue => issue.status === 'done').reduce((sum, issue) => sum + Number(issue.points || 0), 0);
        return { name, issues: items.length, points, completedPoints, progress: points ? Math.round(completedPoints / points * 100) : 0 };
      });
      return json(res, 200, { epics });
    }
    if (url.pathname === '/api/reports/releases' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      const releases = state.releases.filter(item => !projectId || item.projectId === projectId).map(release => ({ ...release, overdue: release.status !== 'released' && release.date ? new Date(release.date) < new Date(dateOnly(new Date())) : false }));
      return json(res, 200, { releases });
    }
    if (url.pathname === '/api/reports/time' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      const issues = state.issues.filter(issue => !projectId || issue.projectId === projectId);
      const rows = issues.map(issue => ({ issueId: issue.id, key: issue.key, title: issue.title, plannedMinutes: Number(issue.originalEstimate || 0), spentMinutes: (issue.worklogs || []).reduce((sum, log) => sum + Number(log.minutes || 0), 0) }));
      return json(res, 200, { rows, totals: { plannedMinutes: rows.reduce((sum, row) => sum + row.plannedMinutes, 0), spentMinutes: rows.reduce((sum, row) => sum + row.spentMinutes, 0) } });
    }
    if (url.pathname === '/api/reports/workload' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      const issues = state.issues.filter(issue => issue.status !== 'done' && (!projectId || issue.projectId === projectId));
      const workload = state.members.map(member => {
        const assigned = issues.filter(issue => issue.assignee === member.id);
        return { memberId: member.id, name: member.name, issues: assigned.length, points: assigned.reduce((sum, issue) => sum + Number(issue.points || 0), 0), overdue: assigned.filter(issue => issue.due && new Date(issue.due) < new Date(dateOnly(new Date()))).length };
      });
      return json(res, 200, { workload });
    }
    if (url.pathname === '/api/dashboard/metrics' && req.method === 'GET') {
      const state = await storage.getState();
      const projectId = url.searchParams.get('projectId');
      const issues = state.issues.filter(issue => !projectId || issue.projectId === projectId);
      const open = issues.filter(issue => issue.status !== 'done');
      const completed = issues.filter(issue => issue.status === 'done');
      const activeSprints = state.sprints.filter(sprint => sprint.status === 'active' && (!projectId || sprint.projectId === projectId));
      const totalPoints = issues.reduce((sum, issue) => sum + Number(issue.points || 0), 0);
      const completedPoints = completed.reduce((sum, issue) => sum + Number(issue.points || 0), 0);
      return json(res, 200, { kpis: { projects: projectId ? 1 : state.projects.filter(project => !project.archived).length, openIssues: open.length, completedIssues: completed.length, completionRate: totalPoints ? Math.round(completedPoints / totalPoints * 100) : 0, overdue: open.filter(issue => issue.due && new Date(issue.due) < new Date(dateOnly(new Date()))).length, activeSprints: activeSprints.length }, byStatus: state.statuses.map(status => ({ statusId: status.id, name: status.name, count: issues.filter(issue => issue.status === status.id).length })), byPriority: ['highest', 'high', 'medium', 'low'].map(priority => ({ priority, count: issues.filter(issue => issue.priority === priority).length })), updatedAt: new Date().toISOString() });
    }

    const dashboardRoute = url.pathname.match(/^\/api\/dashboards(?:\/([^/]+))?$/);
    if (dashboardRoute) {
      const state = await storage.getState();
      state.dashboards = state.dashboards || [];
      const dashboardId = dashboardRoute[1] ? decodeURIComponent(dashboardRoute[1]) : null;
      if (req.method === 'GET') {
        if (dashboardId) {
          const dashboard = state.dashboards.find(item => item.id === dashboardId && (item.visibility === 'shared' || item.ownerId === account.memberId || account.roleId === 'admin'));
          return dashboard ? json(res, 200, { dashboard, version: state.meta.version }) : json(res, 404, { error: 'Dashboard não encontrado.' });
        }
        return json(res, 200, { dashboards: state.dashboards.filter(item => item.visibility === 'shared' || item.ownerId === account.memberId || account.roleId === 'admin'), version: state.meta.version });
      }
      if (readOnly(res, account)) return;
      const body = await parseBody(req);
      if (req.method === 'POST' && !dashboardId) {
        const name = String(body.name || '').trim();
        if (!name) return json(res, 400, { error: 'O nome do dashboard é obrigatório.' });
        const dashboard = { id: makeId('dashboard'), name, ownerId: account.memberId, visibility: body.visibility === 'shared' ? 'shared' : 'private', gadgets: Array.isArray(body.gadgets) ? body.gadgets : [], refreshSeconds: Math.max(15, Number(body.refreshSeconds || 60)), createdAt: new Date().toISOString() };
        state.dashboards.push(dashboard);
        const saved = await save(req, body, state, account, `criou o dashboard ${name}`);
        return json(res, 201, { dashboard, version: saved.meta.version });
      }
      const index = state.dashboards.findIndex(item => item.id === dashboardId);
      if (index < 0) return json(res, 404, { error: 'Dashboard não encontrado.' });
      const dashboard = state.dashboards[index];
      if (dashboard.ownerId !== account.memberId && account.roleId !== 'admin') return json(res, 403, { error: 'Somente o proprietário pode alterar este dashboard.' });
      if (req.method === 'PUT' || req.method === 'PATCH') {
        state.dashboards[index] = { ...dashboard, ...body, id: dashboard.id, ownerId: dashboard.ownerId, gadgets: Array.isArray(body.gadgets) ? body.gadgets : dashboard.gadgets };
        delete state.dashboards[index].version;
        const saved = await save(req, body, state, account, `atualizou o dashboard ${state.dashboards[index].name}`);
        return json(res, 200, { dashboard: state.dashboards[index], version: saved.meta.version });
      }
      if (req.method === 'DELETE') {
        state.dashboards.splice(index, 1);
        const saved = await save(req, body, state, account, `excluiu o dashboard ${dashboard.name}`);
        return json(res, 200, { ok: true, version: saved.meta.version });
      }
    }
    return false;
  };
}

module.exports = { createAnalyticsApi };
