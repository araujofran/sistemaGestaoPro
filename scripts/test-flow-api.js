const assert = require('node:assert/strict');
const { createFlowApi } = require('../src/flow-api');

const yesterday = new Date(Date.now() - 86_400_000).toISOString();
let state = {
  meta: { version: 1 }, currentUser: 'u1', activity: [], boardConfigs: {},
  projects: [{ id: 'p1', key: 'ORB', name: 'Orbit' }],
  statuses: [
    { id: 'todo', name: 'A fazer', color: '#777', limit: 0, position: 0 },
    { id: 'progress', name: 'Em andamento', color: '#00f', limit: 1, position: 1 },
    { id: 'done', name: 'Concluído', color: '#0a0', limit: 0, position: 2 },
  ],
  issues: [
    { id: 'i1', key: 'ORB-1', projectId: 'p1', title: 'Primeira', description: '', status: 'todo', sprintId: null, points: 3, order: 1000, created: yesterday, updated: yesterday },
    { id: 'i2', key: 'ORB-2', projectId: 'p1', title: 'Segunda', description: '', status: 'progress', sprintId: null, points: 5, order: 2000, created: yesterday, updated: yesterday },
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
const api = createFlowApi({ storage, parseBody: async req => req.body || {}, json });
const admin = { memberId: 'u1', roleId: 'admin' };

async function call(method, path, body = {}, account = admin) {
  const req = { method, body, headers: {} };
  const res = {};
  await api(req, res, new URL(path, 'http://localhost'), account);
  return res;
}

async function run() {
  let response = await call('POST', '/api/issues/i1/move', { status: 'progress' });
  assert.equal(response.status, 409);
  assert.equal(response.data.code, 'WIP_LIMIT_REACHED');

  response = await call('PATCH', '/api/statuses/progress', { limit: 2 });
  assert.equal(response.data.status.limit, 2);

  response = await call('POST', '/api/issues/i1/move', { status: 'progress', beforeId: 'i2' });
  assert.equal(response.status, 200);
  assert.equal(response.data.issue.statusHistory.length, 1);

  response = await call('POST', '/api/backlog/rank', { projectId: 'p1', orderedIds: ['i2', 'i1'] });
  assert.deepEqual(response.data.orderedIds, ['i2', 'i1']);
  assert.equal(state.issues.find(issue => issue.id === 'i2').order, 1000);

  response = await call('PATCH', '/api/boards/p1/config', { swimlaneBy: 'assignee', quickFilters: [{ name: 'Alta prioridade', field: 'priority', value: 'high' }], cardFields: ['priority', 'points'] });
  assert.equal(response.data.config.swimlaneBy, 'assignee');

  response = await call('POST', '/api/issues/i1/move', { status: 'done' });
  assert.equal(response.data.issue.status, 'done');

  response = await call('GET', '/api/reports/flow?projectId=p1');
  assert.equal(response.status, 200);
  assert.equal(response.data.throughput, 1);
  assert.equal(response.data.cumulativeFlow.length, 3);
  assert.equal(response.data.historyTracked, 1);

  response = await call('POST', '/api/backlog/rank', { orderedIds: ['i1'] }, { memberId: 'u2', roleId: 'viewer' });
  assert.equal(response.status, 403);

  console.log('Backlog e Kanban: fluxo, WIP e métricas validados com sucesso.');
}

run().catch(error => { console.error(error); process.exit(1); });
