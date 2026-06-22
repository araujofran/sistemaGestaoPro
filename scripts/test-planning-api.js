const assert = require('node:assert/strict');
const { createPlanningApi } = require('../src/planning-api');

let state = {
  meta: { version: 1 }, currentUser: 'u1', activity: [],
  projects: [{ id: 'p1', key: 'ORB', name: 'Orbit', archived: false }],
  issues: [
    { id: 'i1', key: 'ORB-1', projectId: 'p1', title: 'API', status: 'done', points: 5, created: '2026-06-01', due: '2026-06-10' },
    { id: 'i2', key: 'ORB-2', projectId: 'p1', title: 'Interface', status: 'todo', points: 8, created: '2026-06-02', due: '2026-06-20' },
  ],
  sprints: [
    { id: 's1', projectId: 'p1', name: 'Sprint 1', status: 'completed', completedPoints: 5, start: '2026-05-01', end: '2026-05-14' },
    { id: 's2', projectId: 'p1', name: 'Sprint 2', status: 'completed', completedPoints: 8, start: '2026-05-15', end: '2026-05-28' },
  ],
  releases: [{ id: 'r1', projectId: 'p1', name: 'MVP', date: '2026-07-01', status: 'planned' }],
  milestones: [], dependencies: [],
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
const api = createPlanningApi({ storage, parseBody: async req => req.body || {}, json });
const admin = { memberId: 'u1', roleId: 'admin' };

async function call(method, path, body = {}, account = admin) {
  const req = { method, body, headers: {} };
  const res = {};
  await api(req, res, new URL(path, 'http://localhost'), account);
  return res;
}

async function run() {
  let response = await call('POST', '/api/milestones', { projectId: 'p1', name: 'Beta', date: '2026-06-30', status: 'planned' });
  assert.equal(response.status, 201);
  const milestoneId = response.data.milestone.id;

  response = await call('PATCH', `/api/milestones/${milestoneId}`, { status: 'at-risk' });
  assert.equal(response.data.milestone.status, 'at-risk');

  response = await call('POST', '/api/dependencies', { sourceId: 'i1', targetId: 'i2', type: 'blocks' });
  assert.equal(response.status, 201);

  response = await call('POST', '/api/dependencies', { sourceId: 'i2', targetId: 'i1', type: 'blocks' });
  assert.equal(response.status, 409);
  assert.equal(response.data.code, 'DEPENDENCY_CYCLE');

  response = await call('GET', '/api/roadmap?projectId=p1');
  assert.equal(response.data.items.length, 2);
  assert.equal(response.data.milestones.length, 1);
  assert.equal(response.data.dependencies.length, 1);

  response = await call('GET', '/api/forecast?projectId=p1');
  assert.equal(response.data.averageVelocity, 6.5);
  assert.equal(response.data.projectedSprints, 2);
  assert.equal(response.data.confidence, 'medium');

  response = await call('POST', '/api/milestones', { projectId: 'p1', name: 'Bloqueado', date: '2026-07-10' }, { memberId: 'u2', roleId: 'viewer' });
  assert.equal(response.status, 403);

  console.log('Planejamento: roadmap, dependências, marcos e forecast validados.');
}

run().catch(error => { console.error(error); process.exit(1); });
