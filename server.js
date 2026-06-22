const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./src/config');
const { createStorage } = require('./src/storage');
const { createAuth } = require('./src/auth');
const { createResourceApi } = require('./src/resource-api');
const { createLifecycleApi } = require('./src/lifecycle-api');

const PORT = config.port;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const storage = createStorage({ seed: seedState });
const auth = config.storageDriver === 'postgres' ? createAuth({ connectionString: config.databaseUrl, ssl: config.databaseSsl, secureCookies: config.nodeEnv === 'production' }) : null;

const members = [
  { id: 'u1', name: 'Fernanda Rocha', initials: 'FR', role: 'Product Owner', color: '#6757d9' },
  { id: 'u2', name: 'Lucas Mendes', initials: 'LM', role: 'Desenvolvedor', color: '#1f8f75' },
  { id: 'u3', name: 'Bianca Alves', initials: 'BA', role: 'Designer', color: '#d06b38' },
  { id: 'u4', name: 'Rafael Lima', initials: 'RL', role: 'QA Engineer', color: '#3478c9' },
  { id: 'u5', name: 'Sem responsável', initials: '—', role: '', color: '#7d8491' }
];

function daysFromNow(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function seedState() {
  return {
    meta: { workspace: 'Orbit Labs', updatedAt: new Date().toISOString(), version: 1 },
    currentUser: 'u1',
    members,
    projects: [
      { id: 'p1', key: 'ORB', name: 'Orbit Mobile', description: 'Nova experiência mobile para clientes', type: 'scrum', color: '#6757d9', lead: 'u1', archived: false },
      { id: 'p2', key: 'WEB', name: 'Portal Web', description: 'Evolução contínua do portal do cliente', type: 'kanban', color: '#1f8f75', lead: 'u2', archived: false },
      { id: 'p3', key: 'OPS', name: 'Operações', description: 'Confiabilidade, infraestrutura e processos', type: 'kanban', color: '#d06b38', lead: 'u4', archived: false }
    ],
    statuses: [
      { id: 'todo', name: 'A fazer', color: '#77808f', limit: 0 },
      { id: 'progress', name: 'Em andamento', color: '#3478c9', limit: 4 },
      { id: 'review', name: 'Em revisão', color: '#d18728', limit: 3 },
      { id: 'done', name: 'Concluído', color: '#20856e', limit: 0 }
    ],
    sprints: [
      { id: 's1', projectId: 'p1', name: 'Sprint 12 · Navegação', goal: 'Entregar a nova navegação e estabilizar autenticação', start: daysFromNow(-6), end: daysFromNow(8), status: 'active' },
      { id: 's2', projectId: 'p1', name: 'Sprint 13 · Pagamentos', goal: 'Simplificar o fluxo de pagamento', start: daysFromNow(9), end: daysFromNow(23), status: 'planned' }
    ],
    releases: [
      { id: 'r1', projectId: 'p1', name: 'Mobile 2.4', date: daysFromNow(18), status: 'in-progress', progress: 62 },
      { id: 'r2', projectId: 'p2', name: 'Portal Q3', date: daysFromNow(36), status: 'planned', progress: 28 }
    ],
    issues: [
      { id: 'i1', key: 'ORB-142', projectId: 'p1', title: 'Redesenhar navegação principal', description: 'Criar navegação inferior acessível e consistente com o novo design system.', type: 'story', priority: 'high', status: 'progress', assignee: 'u3', reporter: 'u1', sprintId: 's1', epic: 'Experiência mobile', points: 8, due: daysFromNow(4), labels: ['mobile', 'ux'], created: daysFromNow(-12), updated: new Date().toISOString(), order: 1, comments: [{ id: 'c1', author: 'u1', text: 'Protótipo aprovado. Vamos validar os estados de erro.', date: new Date(Date.now() - 86400000).toISOString() }], worklogs: [{ id: 'w1', user: 'u3', minutes: 180, date: daysFromNow(-1), note: 'Fluxos e protótipo' }] },
      { id: 'i2', key: 'ORB-143', projectId: 'p1', title: 'Login com biometria', description: 'Permitir autenticação usando recursos biométricos do dispositivo.', type: 'story', priority: 'highest', status: 'review', assignee: 'u2', reporter: 'u1', sprintId: 's1', epic: 'Autenticação', points: 5, due: daysFromNow(2), labels: ['mobile', 'security'], created: daysFromNow(-10), updated: new Date().toISOString(), order: 1, comments: [], worklogs: [{ id: 'w2', user: 'u2', minutes: 420, date: daysFromNow(-2), note: 'Implementação nativa' }] },
      { id: 'i3', key: 'ORB-144', projectId: 'p1', title: 'Corrigir sessão expirada silenciosamente', description: 'Exibir uma mensagem clara e redirecionar para autenticação.', type: 'bug', priority: 'highest', status: 'todo', assignee: 'u2', reporter: 'u4', sprintId: 's1', epic: 'Autenticação', points: 3, due: daysFromNow(1), labels: ['bug'], created: daysFromNow(-7), updated: new Date().toISOString(), order: 1, comments: [], worklogs: [] },
      { id: 'i4', key: 'ORB-145', projectId: 'p1', title: 'Testes de acessibilidade no checkout', description: 'Cobrir navegação por leitor de tela e contraste.', type: 'task', priority: 'medium', status: 'progress', assignee: 'u4', reporter: 'u1', sprintId: 's1', epic: 'Qualidade', points: 5, due: daysFromNow(6), labels: ['a11y', 'qa'], created: daysFromNow(-5), updated: new Date().toISOString(), order: 2, comments: [], worklogs: [] },
      { id: 'i5', key: 'ORB-146', projectId: 'p1', title: 'Mapear eventos de analytics', description: 'Definir taxonomia de eventos para o funil principal.', type: 'task', priority: 'low', status: 'todo', assignee: 'u5', reporter: 'u1', sprintId: null, epic: 'Métricas', points: 3, due: daysFromNow(15), labels: ['analytics'], created: daysFromNow(-4), updated: new Date().toISOString(), order: 2, comments: [], worklogs: [] },
      { id: 'i6', key: 'ORB-147', projectId: 'p1', title: 'Componente de feedback tátil', description: 'Padronizar feedback de ações importantes.', type: 'story', priority: 'medium', status: 'done', assignee: 'u2', reporter: 'u3', sprintId: 's1', epic: 'Experiência mobile', points: 3, due: daysFromNow(-1), labels: ['mobile'], created: daysFromNow(-14), updated: new Date().toISOString(), order: 1, comments: [], worklogs: [] },
      { id: 'i7', key: 'WEB-87', projectId: 'p2', title: 'Otimizar carregamento do dashboard', description: 'Reduzir LCP para menos de 2,5 segundos.', type: 'story', priority: 'high', status: 'progress', assignee: 'u2', reporter: 'u1', sprintId: null, epic: 'Performance', points: 8, due: daysFromNow(7), labels: ['performance'], created: daysFromNow(-9), updated: new Date().toISOString(), order: 1, comments: [], worklogs: [] },
      { id: 'i8', key: 'WEB-88', projectId: 'p2', title: 'Atualizar central de preferências', description: 'Consolidar notificações e privacidade.', type: 'task', priority: 'medium', status: 'todo', assignee: 'u3', reporter: 'u1', sprintId: null, epic: 'Conta', points: 5, due: daysFromNow(12), labels: ['web'], created: daysFromNow(-3), updated: new Date().toISOString(), order: 1, comments: [], worklogs: [] },
      { id: 'i9', key: 'OPS-31', projectId: 'p3', title: 'Alertas de indisponibilidade por região', description: 'Criar alertas segmentados e runbook.', type: 'task', priority: 'high', status: 'review', assignee: 'u4', reporter: 'u2', sprintId: null, epic: 'Observabilidade', points: 5, due: daysFromNow(3), labels: ['ops'], created: daysFromNow(-8), updated: new Date().toISOString(), order: 1, comments: [], worklogs: [] }
    ],
    activity: [
      { id: 'a1', user: 'u2', text: 'moveu ORB-143 para Em revisão', date: new Date(Date.now() - 3600000).toISOString() },
      { id: 'a2', user: 'u3', text: 'comentou em ORB-142', date: new Date(Date.now() - 86400000).toISOString() },
      { id: 'a3', user: 'u4', text: 'registrou 2h em OPS-31', date: new Date(Date.now() - 172800000).toISOString() }
    ]
  };
}

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(seedState(), null, 2));
}

function readState() {
  ensureData();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeState(state) {
  state.meta = { ...(state.meta || {}), updatedAt: new Date().toISOString(), version: Number(state.meta?.version || 0) + 1 };
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, DATA_FILE);
  return state;
}

function json(res, status, data, headers={}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error('Payload muito grande'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

const handleResourceApi = createResourceApi({ storage, parseBody, json });
const handleLifecycleApi = createLifecycleApi({ storage, parseBody, json });

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, requested);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'Orbit Projects' });
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      if (!auth) return json(res, 200, { authenticated:true, setupRequired:false, account:{name:'Usuário local',roleId:'admin',memberId:'u1'} });
      const account=await auth.authenticate(req);return json(res,200,{authenticated:!!account,setupRequired:account?false:await auth.setupRequired(),account});
    }
    if (url.pathname === '/api/auth/setup' && req.method === 'POST') {
      if (!auth) return json(res,400,{error:'Autenticação requer PostgreSQL.'});
      const data=await parseBody(req),state=await storage.getState(),member=state.members.find(m=>m.id===state.currentUser)||state.members.find(m=>m.name!=='Sem responsável');
      const result=await auth.setup({...data,memberId:member.id});
      member.name=data.name.trim();member.initials=result.account.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();member.role='Administrador';member.roleId='admin';state.currentUser=member.id;
      await storage.saveState(state,Number(state.meta.version));
      return json(res,201,{account:result.account},{'Set-Cookie':auth.cookie(result.token,result.expires)});
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!auth) return json(res,400,{error:'Autenticação requer PostgreSQL.'});
      const result=await auth.login(await parseBody(req));return json(res,200,{account:result.account},{'Set-Cookie':auth.cookie(result.token,result.expires)});
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {if(auth)await auth.logout(req);return json(res,200,{ok:true},{'Set-Cookie':auth?auth.clearCookie():''})}
    const account=auth?await auth.authenticate(req):{memberId:'u1',roleId:'admin',name:'Usuário local'};
    if (url.pathname.startsWith('/api/')&&!account) return json(res,401,{error:'Faça login para continuar.'});
    if (url.pathname === '/api/auth/accounts' && req.method === 'GET') {if(account.roleId!=='admin')return json(res,403,{error:'Acesso restrito a administradores.'});return json(res,200,{accounts:await auth.listAccounts()})}
    if (url.pathname === '/api/auth/accounts' && req.method === 'POST') {if(account.roleId!=='admin')return json(res,403,{error:'Acesso restrito a administradores.'});return json(res,201,{account:await auth.createAccount(await parseBody(req))})}
    const accountRoute=url.pathname.match(/^\/api\/auth\/accounts\/([^/]+)$/);
    if(accountRoute&&req.method==='PUT'){if(account.roleId!=='admin')return json(res,403,{error:'Acesso restrito a administradores.'});const data=await parseBody(req);return json(res,200,await auth.updateRole(decodeURIComponent(accountRoute[1]),data.roleId))}
    if(accountRoute&&req.method==='DELETE'){if(account.roleId!=='admin')return json(res,403,{error:'Acesso restrito a administradores.'});return json(res,200,await auth.deactivate(decodeURIComponent(accountRoute[1]),account.id))}
    if (/^\/api\/(projects|issues)(\/|$)/.test(url.pathname)) {
      await handleResourceApi(req, res, url, account);
      if (!res.headersSent) json(res, 405, { error: 'Método não permitido para esta rota.' });
      return;
    }
    if (/^\/api\/(sprints|releases|reports\/velocity)(\/|$)/.test(url.pathname)) {
      await handleLifecycleApi(req, res, url, account);
      if (!res.headersSent) json(res, 405, { error: 'Método não permitido para esta rota.' });
      return;
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {const state=await storage.getState();return json(res,200,{...state,currentUser:account.memberId})}
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      if (account.roleId==='viewer') return json(res,403,{error:'Seu perfil possui acesso somente para leitura.'});
      const state = await parseBody(req);
      if (!Array.isArray(state.projects) || !Array.isArray(state.issues)) return json(res, 400, { error: 'Estado inválido' });
      state.currentUser=account.memberId;
      return json(res, 200, await storage.saveState(state, Number(state.meta?.version || 0)));
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {if(account.roleId!=='admin')return json(res,403,{error:'Somente administradores podem restaurar os dados.'});return json(res, 200, await storage.reset())}
    if (req.method === 'GET' && serveStatic(req, res, url.pathname)) return;
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(req, res, '/') || undefined;
    json(res, 404, { error: 'Rota não encontrada' });
  } catch (error) {
    json(res, error.statusCode || 500, { error: error.message || 'Erro interno' });
  }
});

async function start() {
  await storage.initialize();
  if(auth)await auth.initialize();
  server.listen(PORT, () => console.log(`Orbit Projects disponível em http://localhost:${PORT} usando ${config.storageDriver}`));
}

async function shutdown() {
  server.close(async () => {
    await storage.close();
    if(auth)await auth.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start().catch(error => { console.error(`Falha ao iniciar: ${error.message}`); process.exit(1); });
