const assert = require('node:assert/strict');
const { createAiApi } = require('../src/ai-api');
let state = { meta: { version: 1 }, currentUser: 'u1', projects: [{ id: 'p1', key: 'ORB' }], members: [{ id: 'u1', name: 'Ana' }], issues: [{ id: 'i1', key: 'ORB-1', projectId: 'p1', title: 'Corrigir login', description: 'Falha de autenticação', type: 'bug', priority: 'high', status: 'todo', assignee: 'u1', reporter: 'u1', sprintId: null, points: 5, labels: ['security'], comments: [{ author: 'u1', text: 'Reproduzido no ambiente de teste.' }], worklogs: [{ minutes: 30 }] }] };
const storage = { async getState() { return structuredClone(state); }, async saveState(next, expected) { assert.equal(expected, state.meta.version); next.meta.version = expected + 1; state = structuredClone(next); return structuredClone(state); } };
const json = (res, status, data) => Object.assign(res, { status, data });
const api = createAiApi({ storage, parseBody: async req => req.body || {}, json });
const member = { memberId: 'u1', roleId: 'member' };
async function call(path, body = {}, account = member) { const req = { method: 'POST', body, headers: {} }, res = {}; await api(req, res, new URL(path, 'http://localhost'), account); return res; }
async function run() {
  let response = await call('/api/ai/task-summary', { issueId: 'i1' }); assert.match(response.data.summary, /ORB-1/); assert.equal(response.data.mode, 'local');
  response = await call('/api/ai/generate-description', { title: 'novo checkout', context: 'simplificar pagamento' }); assert.match(response.data.description, /Critérios de aceite/);
  response = await call('/api/ai/subtasks', { issueId: 'i1' }); assert.equal(response.data.suggestions.length, 4);
  response = await call('/api/ai/subtasks', { issueId: 'i1', create: true }); assert.equal(response.status, 201); assert.equal(response.data.subtasks[0].parentId, 'i1');
  response = await call('/api/ai/automation-suggestion', { issueId: 'i1' }); assert.equal(response.data.suggestions.length, 1);
  response = await call('/api/ai/smart-search', { query: 'autenticacao security' }); assert.equal(response.data.results[0].issue.key, 'ORB-1');
  response = await call('/api/ai/comments-summary', { issueId: 'i1' }); assert.equal(response.data.commentCount, 1);
  response = await call('/api/ai/writing-assistant', { text: 'vc precisa revisar isso pra amanhã.', tone: 'formal' }); assert.match(response.data.text, /Você precisa/);
  response = await call('/api/ai/subtasks', { issueId: 'i1', create: true }, { memberId: 'u2', roleId: 'viewer' }); assert.equal(response.status, 403);
  console.log('Funcionalidades locais de IA validadas com sucesso.');
}
run().catch(error => { console.error(error); process.exit(1); });
