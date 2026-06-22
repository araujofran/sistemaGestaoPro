const assert = require('node:assert/strict');
const { createSearchAutomationApi } = require('../src/search-automation-api');
const { runAutomationRules } = require('../src/automation-engine');

let state = {
  meta: { version: 1 }, currentUser: 'u1', activity: [],
  projects: [{ id: 'p1', key: 'ORB', name: 'Orbit' }],
  issues: [
    { id: 'i1', key: 'ORB-1', projectId: 'p1', title: 'Corrigir autenticação', description: 'Falha no login', type: 'bug', priority: 'high', status: 'todo', assignee: 'u2', points: 5, labels: ['security'], comments: [] },
    { id: 'i2', key: 'ORB-2', projectId: 'p1', title: 'Atualizar documentação', description: '', type: 'task', priority: 'low', status: 'done', assignee: 'u1', points: 2, labels: [], comments: [] },
  ],
  savedFilters: [], automationRules: [], automationRuns: [], webhookOutbox: [],
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
const api = createSearchAutomationApi({ storage, parseBody: async req => req.body || {}, json });
const admin = { memberId: 'u1', roleId: 'admin' };

async function call(method, path, body = {}, account = admin) {
  const req = { method, body, headers: {} };
  const res = {};
  await api(req, res, new URL(path, 'http://localhost'), account);
  return res;
}

async function run() {
  let response = await call('GET', '/api/search?q=autentica%C3%A7%C3%A3o');
  assert.equal(response.data.total, 1);

  response = await call('GET', '/api/search/advanced?q=priority%20IN%20(high%2Chighest)%20AND%20points%20%3E%3D%205');
  assert.equal(response.data.issues[0].key, 'ORB-1');

  response = await call('POST', '/api/filters', { name: 'Bugs importantes', query: 'type = bug AND priority = high', visibility: 'shared' });
  assert.equal(response.status, 201);
  const filterId = response.data.filter.id;

  response = await call('POST', `/api/filters/${filterId}/subscribe`, {}, { memberId: 'u2', roleId: 'member' });
  assert.deepEqual(response.data.filter.subscribers, ['u2']);

  response = await call('POST', '/api/automations', {
    name: 'Classificar bugs de segurança', trigger: { type: 'issue.created' },
    conditions: [{ field: 'type', operator: 'equals', value: 'bug' }],
    actions: [{ type: 'add-label', value: 'triage' }, { type: 'comment', text: 'Triagem automática iniciada.' }, { type: 'webhook', url: 'https://example.invalid/hook' }],
  });
  assert.equal(response.status, 201);
  const rule = state.automationRules[0];

  const issue = { id: 'i3', key: 'ORB-3', projectId: 'p1', title: 'Novo bug', type: 'bug', labels: [], comments: [] };
  state.issues.push(issue);
  const runs = runAutomationRules(state, { type: 'issue.created', issue }, 'u1');
  assert.equal(runs.length, 1);
  assert.deepEqual(issue.labels, ['triage']);
  assert.equal(issue.comments.length, 1);
  assert.equal(state.webhookOutbox[0].status, 'pending');
  assert.equal(rule.runCount, 1);

  response = await call('POST', '/api/automations', { name: 'Proibida', trigger: { type: 'manual' }, actions: [{ type: 'add-label', value: 'x' }] }, { memberId: 'u2', roleId: 'member' });
  assert.equal(response.status, 403);

  console.log('Busca, filtros e automações validados com sucesso.');
}

run().catch(error => { console.error(error); process.exit(1); });
