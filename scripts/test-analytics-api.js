const assert = require('node:assert/strict');
const { createAnalyticsApi } = require('../src/analytics-api');

let state = {
  meta: { version: 1 }, currentUser: 'u1', activity: [], dashboards: [],
  projects: [{ id: 'p1', name: 'Orbit', archived: false }],
  members: [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Beto' }],
  statuses: [{ id: 'todo', name: 'A fazer' }, { id: 'progress', name: 'Em andamento' }, { id: 'done', name: 'Concluído' }],
  sprints: [{ id: 's1', projectId: 'p1', name: 'Sprint 1', status: 'completed', start: '2026-06-01', end: '2026-06-07' }],
  releases: [{ id: 'r1', projectId: 'p1', name: 'MVP', date: '2026-12-01', status: 'planned', progress: 50 }],
  issues: [
    { id: 'i1', key: 'ORB-1', projectId: 'p1', sprintId: 's1', title: 'Concluída', status: 'done', priority: 'high', assignee: 'u1', epic: 'MVP', points: 5, created: '2026-06-01', updated: '2026-06-04', originalEstimate: 300, worklogs: [{ minutes: 240 }] },
    { id: 'i2', key: 'ORB-2', projectId: 'p1', sprintId: 's1', title: 'Pendente', status: 'progress', priority: 'medium', assignee: 'u2', epic: 'MVP', points: 3, created: '2026-06-01', updated: '2026-06-05', originalEstimate: 180, worklogs: [{ minutes: 120 }] },
  ],
};

const storage = {
  async getState() { return structuredClone(state); },
  async saveState(next, expected) {
    assert.equal(expected, state.meta.version);
    next.meta.version = expected + 1;
    state = structuredClone(next);
    return structuredClone(state);
  },
};
const json = (res, status, data) => Object.assign(res, { status, data });
const api = createAnalyticsApi({ storage, parseBody: async req => req.body || {}, json });
const admin = { memberId: 'u1', roleId: 'admin' };

async function call(method, path, body = {}, account = admin) {
  const req = { method, body, headers: {} };
  const res = {};
  await api(req, res, new URL(path, 'http://localhost'), account);
  return res;
}

async function run() {
  let response = await call('GET', '/api/reports/burndown?sprintId=s1');
  assert.equal(response.data.totalPoints, 8);
  assert.equal(response.data.burndown.length, 7);

  response = await call('GET', '/api/reports/burnup?sprintId=s1');
  assert.equal(response.data.burnup.at(-1).completed, 5);

  response = await call('GET', '/api/reports/sprint?sprintId=s1');
  assert.equal(response.data.completedPoints, 5);
  assert.equal(response.data.incomplete.length, 1);

  response = await call('GET', '/api/reports/epics?projectId=p1');
  assert.equal(response.data.epics[0].progress, 63);

  response = await call('GET', '/api/reports/time?projectId=p1');
  assert.deepEqual(response.data.totals, { plannedMinutes: 480, spentMinutes: 360 });

  response = await call('GET', '/api/reports/workload?projectId=p1');
  assert.equal(response.data.workload.find(item => item.memberId === 'u2').points, 3);

  response = await call('GET', '/api/dashboard/metrics?projectId=p1');
  assert.equal(response.data.kpis.completionRate, 63);
  assert.equal(response.data.kpis.openIssues, 1);

  response = await call('POST', '/api/dashboards', { name: 'Executivo', visibility: 'shared', gadgets: [{ type: 'kpi', metric: 'completionRate' }] });
  assert.equal(response.status, 201);
  const dashboardId = response.data.dashboard.id;

  response = await call('PATCH', `/api/dashboards/${dashboardId}`, { refreshSeconds: 30, gadgets: [{ type: 'burndown', sprintId: 's1' }] });
  assert.equal(response.data.dashboard.refreshSeconds, 30);

  response = await call('POST', '/api/dashboards', { name: 'Bloqueado' }, { memberId: 'u2', roleId: 'viewer' });
  assert.equal(response.status, 403);

  console.log('Relatórios e dashboards validados com sucesso.');
}

run().catch(error => { console.error(error); process.exit(1); });
