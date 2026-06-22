const assert = require('node:assert/strict');
const { createLifecycleApi } = require('../src/lifecycle-api');

let state = {
  meta: { version: 1 }, currentUser: 'u1', members: [], activity: [],
  projects: [{ id: 'p1', key: 'ORB', name: 'Orbit' }],
  sprints: [{ id: 's1', projectId: 'p1', name: 'Sprint 1', goal: 'Entregar MVP', status: 'planned', capacity: 13 }],
  issues: [
    { id: 'i1', key: 'ORB-1', projectId: 'p1', sprintId: 's1', status: 'done', points: 5 },
    { id: 'i2', key: 'ORB-2', projectId: 'p1', sprintId: 's1', status: 'progress', points: 8 },
  ],
  releases: [],
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
const api = createLifecycleApi({ storage, parseBody: async req => req.body || {}, json });
const admin = { memberId: 'u1', roleId: 'admin' };

async function call(method, path, body = {}, account = admin) {
  const req = { method, body, headers: {} };
  const res = {};
  await api(req, res, new URL(path, 'http://localhost'), account);
  return res;
}

async function run() {
  let response = await call('POST', '/api/sprints', { projectId: 'p1', name: 'Sprint 2', goal: 'Finalizar MVP', capacity: 21 });
  assert.equal(response.status, 201);
  const nextSprint = response.data.sprint.id;

  response = await call('POST', '/api/sprints/s1/start');
  assert.equal(response.data.sprint.status, 'active');

  response = await call('POST', '/api/sprints/s1/complete', { moveIncompleteTo: nextSprint });
  assert.deepEqual(response.data.summary, { completed: 1, incomplete: 1, completedPoints: 5, movedTo: nextSprint });
  assert.equal(state.issues.find(issue => issue.id === 'i2').sprintId, nextSprint);

  response = await call('GET', '/api/reports/velocity?projectId=p1');
  assert.equal(response.data.average, 5);

  response = await call('POST', '/api/releases', { projectId: 'p1', name: 'MVP 1.0', status: 'in-progress', progress: 70, notes: 'Homologação' });
  assert.equal(response.status, 201);
  const releaseId = response.data.release.id;

  response = await call('PATCH', `/api/releases/${releaseId}`, { status: 'released', progress: 100 });
  assert.equal(response.data.release.status, 'released');

  response = await call('POST', '/api/sprints', { projectId: 'p1', name: 'Bloqueada' }, { memberId: 'u2', roleId: 'viewer' });
  assert.equal(response.status, 403);

  console.log('Scrum e releases: ciclo de vida validado com sucesso.');
}

run().catch(error => { console.error(error); process.exit(1); });
