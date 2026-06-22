const crypto = require('node:crypto');

const id = prefix => `${prefix}_${crypto.randomUUID()}`;

function compare(actual, operator, expected) {
  if (operator === 'equals') return String(actual ?? '') === String(expected ?? '');
  if (operator === 'not-equals') return String(actual ?? '') !== String(expected ?? '');
  if (operator === 'contains') return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
  if (operator === 'greater-than') return Number(actual || 0) > Number(expected || 0);
  if (operator === 'less-than') return Number(actual || 0) < Number(expected || 0);
  if (operator === 'is-empty') return actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && !actual.length);
  return false;
}

function matches(issue, conditions = []) {
  return conditions.every(condition => compare(issue[condition.field], condition.operator || 'equals', condition.value));
}

function applyActions(state, issue, actions, actorId, rule) {
  const results = [];
  for (const action of actions || []) {
    if (action.type === 'set-field' && ['status', 'priority', 'assignee', 'sprintId', 'due', 'points', 'epic'].includes(action.field)) {
      issue[action.field] = action.value;
      issue.updated = new Date().toISOString();
      results.push({ type: action.type, field: action.field, value: action.value });
    } else if (action.type === 'add-label') {
      issue.labels = [...new Set([...(issue.labels || []), String(action.value || '').trim()].filter(Boolean))];
      results.push({ type: action.type, value: action.value });
    } else if (action.type === 'comment') {
      issue.comments = issue.comments || [];
      issue.comments.push({ id: id('comment'), author: actorId, text: String(action.text || ''), date: new Date().toISOString(), automated: true });
      results.push({ type: action.type });
    } else if (action.type === 'create-issue') {
      const project = state.projects.find(item => item.id === (action.projectId || issue.projectId));
      if (!project) continue;
      const sequence = Math.max(0, ...state.issues.filter(item => item.projectId === project.id).map(item => Number(String(item.key).split('-').pop()) || 0)) + 1;
      const created = { id: id('issue'), key: `${project.key}-${sequence}`, projectId: project.id, title: String(action.title || `Acompanhamento de ${issue.key}`), description: String(action.description || ''), type: action.issueType || 'task', priority: action.priority || 'medium', status: action.status || 'todo', assignee: action.assignee || null, reporter: actorId, sprintId: null, points: Number(action.points || 0), labels: ['automation'], created: new Date().toISOString(), updated: new Date().toISOString(), order: state.issues.length + 1, comments: [], worklogs: [], createdByRuleId: rule.id };
      state.issues.push(created);
      results.push({ type: action.type, issueId: created.id, key: created.key });
    } else if (action.type === 'webhook') {
      state.webhookOutbox = state.webhookOutbox || [];
      const queued = { id: id('webhook'), ruleId: rule.id, url: action.url, payload: { event: rule.trigger.type, issueId: issue.id, issueKey: issue.key }, status: 'pending', attempts: 0, createdAt: new Date().toISOString() };
      state.webhookOutbox.push(queued);
      results.push({ type: action.type, outboxId: queued.id });
    }
  }
  return results;
}

function runAutomationRules(state, event, actorId) {
  state.automationRules = state.automationRules || [];
  state.automationRuns = state.automationRuns || [];
  const issue = event.issue;
  const runs = [];
  for (const rule of state.automationRules.filter(item => item.enabled !== false && item.trigger?.type === event.type)) {
    if (!issue || !matches(issue, rule.conditions)) continue;
    const actions = applyActions(state, issue, rule.actions, actorId, rule);
    const run = { id: id('automation_run'), ruleId: rule.id, trigger: event.type, issueId: issue.id, status: 'success', actions, executedAt: new Date().toISOString(), actorId };
    state.automationRuns.unshift(run);
    rule.lastRunAt = run.executedAt;
    rule.runCount = Number(rule.runCount || 0) + 1;
    runs.push(run);
  }
  return runs;
}

module.exports = { runAutomationRules, matches };
