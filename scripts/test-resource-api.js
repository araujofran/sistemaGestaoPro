const assert = require('node:assert/strict');
const { createResourceApi } = require('../src/resource-api');

let state = {
  meta: { version: 1 }, currentUser: 'u1', members: [],
  projects: [{ id: 'p1', key: 'ORB', name: 'Orbit', description: '', type: 'kanban', color: '#000', archived: false }],
  issues: [], sprints: [], releases: [], activity: [],
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
const api = createResourceApi({ storage, parseBody: async req => req.body || {}, json });
const account = { id: 'a1', memberId: 'u1', roleId: 'admin' };

async function call(method, path, body = {}, actor = account) {
  const req = { method, body, headers: {} };
  const res = {};
  await api(req, res, new URL(path, 'http://localhost'), actor);
  return res;
}

async function run() {
  let response = await call('POST', '/api/projects', { name: 'Portal', key: 'web', type: 'scrum' });
  assert.equal(response.status, 201);
  assert.equal(response.data.project.key, 'WEB');
  const projectId = response.data.project.id;

  response = await call('PATCH', `/api/projects/${projectId}`, { description: 'Portal do cliente' });
  assert.equal(response.data.project.description, 'Portal do cliente');

  response = await call('POST', '/api/issues', { projectId, title: 'Criar autenticação', type: 'story' });
  assert.equal(response.status, 201);
  assert.equal(response.data.issue.key, 'WEB-1');
  const issueId = response.data.issue.id;

  response = await call('GET', '/api/issues?q=autentica%C3%A7%C3%A3o');
  assert.equal(response.data.issues.length, 1);

  response = await call('PATCH', `/api/issues/${issueId}`, { status: 'done', labels: ['segurança'] });
  assert.equal(response.data.issue.status, 'done');

  response = await call('DELETE', `/api/issues/${issueId}`);
  assert.equal(response.data.ok, true);

  response = await call('DELETE', `/api/projects/${projectId}`);
  assert.equal(response.data.archived, true);

  response = await call('POST', '/api/projects', { name: 'Bloqueado', key: 'BLQ' }, { memberId: 'u2', roleId: 'viewer' });
  assert.equal(response.status, 403);

  console.log('REST API: projetos e tarefas validados com sucesso.');
}

run().catch(error => { console.error(error); process.exit(1); });
