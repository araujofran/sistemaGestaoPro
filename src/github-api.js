const crypto = require('node:crypto');
const config = require('./config');

function createGitHubApi({ storage, json, parseBody }) {
  const headers = () => ({ Accept: 'application/vnd.github+json', 'User-Agent': 'Orbit-Projects', 'X-GitHub-Api-Version': '2022-11-28', ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}) });
  async function request(path) { const response = await fetch(`https://api.github.com${path}`, { headers: headers() }); if (!response.ok) { const error = new Error(response.status === 403 ? 'Limite ou permissão da API do GitHub insuficiente.' : `GitHub respondeu HTTP ${response.status}.`); error.statusCode = response.status; throw error; } return response.json(); }
  const repoPath = () => `/repos/${config.githubRepository}`;
  const issueIds = (state, text) => { const keys = [...new Set(String(text || '').match(/[A-Z][A-Z0-9]+-\d+/g) || [])]; return state.issues.filter(issue => keys.includes(issue.key)).map(issue => issue.id); };
  async function overview() {
    const [repo, commits, branches, pulls, runs] = await Promise.all([request(repoPath()), request(`${repoPath()}/commits?per_page=20`), request(`${repoPath()}/branches?per_page=30`), request(`${repoPath()}/pulls?state=all&per_page=20`), request(`${repoPath()}/actions/runs?per_page=20`)]);
    return { repository: { fullName: repo.full_name, url: repo.html_url, defaultBranch: repo.default_branch, visibility: repo.visibility }, commits: commits.map(item => ({ sha: item.sha, title: item.commit.message.split('\n')[0], author: item.author?.login || item.commit.author?.name, date: item.commit.author?.date, url: item.html_url })), branches: branches.map(item => ({ name: item.name, sha: item.commit.sha, protected: item.protected })), pulls: pulls.map(item => ({ number: item.number, title: item.title, state: item.state, draft: item.draft, author: item.user?.login, url: item.html_url, updatedAt: item.updated_at })), runs: (runs.workflow_runs || []).map(item => ({ id: item.id, name: item.name, status: item.status, conclusion: item.conclusion, branch: item.head_branch, event: item.event, url: item.html_url, updatedAt: item.updated_at })) };
  }
  return async function handle(req, res, url, account) {
    if (url.pathname === '/api/github/status' && req.method === 'GET') return json(res, 200, { repository: config.githubRepository, configured: Boolean(config.githubRepository), authenticated: Boolean(config.githubToken), webhookConfigured: Boolean(config.githubWebhookSecret) });
    if (url.pathname === '/api/github/overview' && req.method === 'GET') return json(res, 200, await overview());
    if (url.pathname === '/api/github/sync' && req.method === 'POST') { if (account.roleId !== 'admin') return json(res, 403, { error: 'Sincronização restrita a administradores.' }); const data = await overview(), state = await storage.getState(); state.devopsEvents = state.devopsEvents || []; const existing = new Set(state.devopsEvents.map(item => item.externalId)); for (const commit of data.commits) if (!existing.has(commit.sha)) state.devopsEvents.unshift({ id: `github_${commit.sha.slice(0, 12)}`, externalId: commit.sha, provider: 'GitHub', type: 'commit', title: commit.title, url: commit.url, status: null, issueIds: issueIds(state, commit.title), createdAt: commit.date }); state.currentUser = account.memberId; const saved = await storage.saveState(state, Number(state.meta.version)); return json(res, 200, { ...data, imported: data.commits.length, version: saved.meta.version }); }
    if (url.pathname === '/api/github/test' && req.method === 'POST') { if (account.roleId !== 'admin') return json(res, 403, { error: 'Acesso restrito.' }); const data = await request(repoPath()); return json(res, 200, { ok: true, repository: data.full_name, permissions: data.permissions || { pull: true } }); }
    return false;
  };
}

function verifyWebhook(signature, body) { if (!config.githubWebhookSecret || !signature) return false; const expected = `sha256=${crypto.createHmac('sha256', config.githubWebhookSecret).update(body).digest('hex')}`; try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; } }

module.exports = { createGitHubApi, verifyWebhook };
