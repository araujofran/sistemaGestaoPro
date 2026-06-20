const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
const containerName = 'orbit-postgres';
const port = 5433;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`Falha ao executar ${command} ${args.join(' ')}`);
}

function dockerOutput(args) {
  return spawnSync('docker', args, { cwd: root, encoding: 'utf8', shell: false });
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)]}));
}

async function waitForDatabase(connectionString) {
  for (let attempt = 1; attempt <= 40; attempt++) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await client.end().catch(()=>{});
      await new Promise(resolve=>setTimeout(resolve, 1500));
    }
  }
  throw new Error('PostgreSQL não ficou disponível no tempo esperado');
}

async function main() {
  const info = dockerOutput(['info', '--format', '{{.ServerVersion}}']);
  if (info.status !== 0) throw new Error('Abra o Docker Desktop e aguarde aparecer "Engine running" antes de tentar novamente.');

  let env;
  if (fs.existsSync(envFile)) {
    env = parseEnv(fs.readFileSync(envFile, 'utf8'));
    if (!env.POSTGRES_PASSWORD || !env.DATABASE_URL) throw new Error('O .env existente não possui POSTGRES_PASSWORD e DATABASE_URL completos.');
  } else {
    const password = crypto.randomBytes(24).toString('base64url');
    const sessionSecret = crypto.randomBytes(48).toString('base64url');
    env = {
      NODE_ENV: 'development', PORT: '4173', STORAGE_DRIVER: 'postgres',
      DATABASE_URL: `postgresql://orbit_app:${password}@127.0.0.1:${port}/orbit_projects`,
      DATABASE_SSL: 'false', SESSION_SECRET: sessionSecret,
      POSTGRES_DB: 'orbit_projects', POSTGRES_USER: 'orbit_app', POSTGRES_PASSWORD: password,
    };
    fs.writeFileSync(envFile, Object.entries(env).map(([key,value])=>`${key}=${value}`).join('\n')+'\n', { mode: 0o600 });
    console.log('.env criado com credenciais aleatórias locais. A senha não será exibida.');
  }

  const existing = dockerOutput(['container', 'inspect', containerName]);
  if (existing.status === 0) {
    run('docker', ['start', containerName]);
  } else {
    run('docker', [
      'run','-d','--name',containerName,
      '-e',`POSTGRES_DB=${env.POSTGRES_DB}`,
      '-e',`POSTGRES_USER=${env.POSTGRES_USER}`,
      '-e',`POSTGRES_PASSWORD=${env.POSTGRES_PASSWORD}`,
      '-p',`${port}:5432`,
      '-v','orbit-postgres-data:/var/lib/postgresql',
      '--restart','unless-stopped','postgres:18-alpine'
    ]);
  }

  console.log('Aguardando PostgreSQL...');
  await waitForDatabase(env.DATABASE_URL);
  const childEnv = { ...process.env, ...env };
  run(process.execPath, ['scripts/migrate.js'], { env: childEnv });
  run(process.execPath, ['scripts/import-json.js'], { env: childEnv });
  console.log(`PostgreSQL configurado em 127.0.0.1:${port}; migrations e importação concluídas.`);
}

main().catch(error=>{console.error(`Erro: ${error.message}`);process.exitCode=1});
