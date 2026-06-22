const assert = require('node:assert/strict');
const { createEcosystemApi } = require('../src/ecosystem-api');
const { decrypt } = require('../src/secret-vault');
let state = { meta: { version: 1 }, currentUser: 'u1', activity: [], projects: [{ id: 'p1', key: 'ORB', archived: false }], issues: [{ id: 'i1', key: 'ORB-1', projectId: 'p1', status: 'todo', points: 5 }], knowledgePages: [] };
const storage = { async getState() { return structuredClone(state); }, async saveState(next, expected) { assert.equal(expected, state.meta.version); next.meta.version = expected + 1; state = structuredClone(next); return structuredClone(state); } };
const json = (res, status, data) => Object.assign(res, { status, data });
const api = createEcosystemApi({ storage, parseBody: async req => req.body || {}, json });
const admin = { memberId: 'u1', roleId: 'admin' };
async function call(method, path, body = {}, account = admin) { const req = { method, body, headers: {} }, res = {}; await api(req, res, new URL(path, 'http://localhost'), account); return res; }
async function run() {
  let response = await call('POST', '/api/knowledge', { title: 'Requisitos do MVP', type: 'requirement', content: 'Versão inicial', projectId: 'p1' }); assert.equal(response.status, 201); const pageId = response.data.page.id;
  response = await call('PATCH', `/api/knowledge/${pageId}`, { content: 'Versão revisada' }); assert.equal(response.data.page.version, 2); assert.equal(response.data.page.history.length, 1);
  response = await call('POST', '/api/devops/events', { provider: 'GitHub', type: 'pull-request', title: 'Corrige ORB-1', url: 'https://github.com/example/pr/1' }); assert.deepEqual(response.data.event.issueIds, ['i1']);
  response = await call('POST', '/api/api-keys', { name: 'Power BI', scopes: ['read'] }); assert.match(response.data.token, /^orb_/); assert.equal(response.data.apiKey.tokenHash, undefined); assert.ok(state.apiKeys[0].tokenHash);
  response = await call('POST', '/api/test-cases', { name: 'Login válido', steps: ['Abrir', 'Autenticar'], expected: 'Dashboard' }); assert.equal(response.status, 201);
  response = await call('POST', '/api/integration-connections', { provider: 'Slack', secret: 'segredo', active: true }); assert.equal(response.data.item.secretCipher, undefined); assert.equal(response.data.item.secretConfigured, true); assert.ok(state.integrationConnections[0].secretCipher); assert.equal(decrypt(state.integrationConnections[0].secretCipher), 'segredo');
  response = await call('POST', '/api/marketplace/installations', { app: 'Gantt', enabled: true }); assert.equal(response.status, 201);
  await call('POST', '/api/portfolios', { name: 'Portfólio Digital', projectIds: ['p1'] });
  await call('POST', '/api/capacity-plans', { teamId: 't1', capacity: 40, period: '2026-Q3' });
  response = await call('GET', '/api/enterprise/insights'); assert.equal(response.data.portfolio.projects, 1); assert.equal(response.data.portfolio.totalCapacity, 40);
  response = await call('POST', '/api/api-keys', { name: 'Negada' }, { memberId: 'u2', roleId: 'member' }); assert.equal(response.status, 403);
  console.log('Conhecimento, DevOps, testes, integrações, Marketplace e Enterprise validados.');
}
run().catch(error => { console.error(error); process.exit(1); });
