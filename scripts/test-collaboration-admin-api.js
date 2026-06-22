const assert = require('node:assert/strict');
const { createCollaborationAdminApi } = require('../src/collaboration-admin-api');

let state = { meta: { version: 1 }, currentUser: 'u1', activity: [], projects: [{ id: 'p1' }], members: [{ id: 'u1', name: 'Ana Lima' }, { id: 'u2', name: 'Beto Silva' }], issues: [{ id: 'i1', key: 'ORB-1', projectId: 'p1', title: 'Validar', status: 'todo', assignee: 'u2', comments: [], worklogs: [] }], workflows: [], approvals: [], notifications: [], teams: [], groups: [] };
const storage = { async getState() { return structuredClone(state); }, async saveState(next, expected) { assert.equal(expected, state.meta.version); next.meta.version = expected + 1; state = structuredClone(next); return structuredClone(state); } };
const json = (res, status, data) => Object.assign(res, { status, data });
const api = createCollaborationAdminApi({ storage, parseBody: async req => req.body || {}, json });
const admin = { memberId: 'u1', roleId: 'admin' };
async function call(method, path, body = {}, account = admin) { const req = { method, body, headers: {} }, res = {}; await api(req, res, new URL(path, 'http://localhost'), account); return res; }

async function run() {
  let response = await call('POST', '/api/workflows', { name: 'Entrega', states: ['todo', 'progress', 'done'], transitions: [{ id: 'start', from: 'todo', to: 'progress', validators: [{ type: 'required-field', field: 'assignee' }] }, { id: 'finish', from: 'progress', to: 'done', approvalRequired: true, approvers: ['u1'] }] });
  const workflowId = response.data.workflow.id; assert.equal(response.status, 201);
  response = await call('POST', `/api/workflows/${workflowId}/transition`, { issueId: 'i1', transitionId: 'start' }); assert.equal(response.data.issue.status, 'progress');
  response = await call('POST', `/api/workflows/${workflowId}/transition`, { issueId: 'i1', transitionId: 'finish' }); assert.equal(response.status, 202); const approvalId = response.data.approval.id;
  response = await call('POST', `/api/approvals/${approvalId}/decide`, { decision: 'approved' }); assert.equal(response.data.approval.status, 'approved'); assert.equal(state.issues[0].status, 'done');
  await call('POST', '/api/issues/i1/watchers', { memberId: 'u2' });
  response = await call('POST', '/api/issues/i1/comments', { text: 'Revise por favor @u2' }); assert.equal(response.status, 201); assert.equal(state.notifications.filter(item => item.memberId === 'u2').length, 2);
  response = await call('POST', '/api/issues/i1/worklogs', { minutes: 90, note: 'Revisão' }); assert.equal(response.data.worklog.minutes, 90);
  response = await call('POST', '/api/teams', { name: 'Produto', members: ['u1', 'u2'] }); assert.equal(response.status, 201);
  response = await call('PATCH', '/api/security', { settings: { mfaRequired: true }, permissions: { member: ['issue.read', 'issue.write'] } }); assert.equal(response.data.settings.mfaRequired, true);
  response = await call('POST', '/api/workflows', { name: 'Negado', states: [], transitions: [] }, { memberId: 'u2', roleId: 'member' }); assert.equal(response.status, 403);
  console.log('Workflows, colaboração, tempo, equipes e segurança validados.');
}
run().catch(error => { console.error(error); process.exit(1); });
