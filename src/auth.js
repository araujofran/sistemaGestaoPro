const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { Pool } = require('pg');

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 7;

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, salt, expectedHex] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const derived = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(v=>v.trim()).filter(Boolean).map(pair=>{const at=pair.indexOf('=');return [decodeURIComponent(pair.slice(0,at)),decodeURIComponent(pair.slice(at+1))]}));
}

function createAuth({ connectionString, ssl, secureCookies }) {
  const pool = new Pool({ connectionString, ssl: ssl ? { rejectUnauthorized: false } : false, max: 5 });

  async function createSession(client, accountId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
    await client.query('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)', [tokenHash(token), accountId, expires]);
    return { token, expires };
  }

  return {
    async initialize() {
      await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
    },
    async setupRequired() {
      const result = await pool.query('SELECT COUNT(*)::int count FROM accounts WHERE active=true');
      return result.rows[0].count === 0;
    },
    async setup({ name, email, password, memberId }) {
      if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || String(password).length < 10) {
        const error = new Error('Informe nome, e-mail válido e senha com pelo menos 10 caracteres.');error.statusCode=400;throw error;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const count = await client.query('SELECT COUNT(*)::int count FROM accounts');
        if (count.rows[0].count) {const error=new Error('O administrador inicial já foi configurado.');error.statusCode=409;throw error}
        const accountId = `acc_${crypto.randomUUID()}`;
        const passwordHash = await hashPassword(password);
        await client.query('UPDATE users SET name=$1, initials=$2, role_id=$3 WHERE id=$4', [name.trim(),initials(name),'admin',memberId]);
        await client.query('INSERT INTO accounts(id,member_id,email,password_hash,role_id) VALUES($1,$2,$3,$4,$5)', [accountId,memberId,email.trim().toLowerCase(),passwordHash,'admin']);
        const session = await createSession(client, accountId);
        await client.query('INSERT INTO audit_log(actor_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4)', [memberId,'auth.setup','account',accountId]);
        await client.query('COMMIT');
        return { ...session, account:{id:accountId,memberId,name:name.trim(),email:email.trim().toLowerCase(),roleId:'admin'} };
      } catch(error) {await client.query('ROLLBACK');throw error} finally {client.release()}
    },
    async login({ email, password }) {
      const result = await pool.query('SELECT a.*,u.name FROM accounts a JOIN users u ON u.id=a.member_id WHERE lower(a.email)=lower($1) AND a.active=true', [email || '']);
      const row = result.rows[0];
      if (!row || !(await verifyPassword(password || '', row.password_hash))) {const error=new Error('E-mail ou senha inválidos.');error.statusCode=401;throw error}
      const client = await pool.connect();
      try {const session=await createSession(client,row.id);await client.query('INSERT INTO audit_log(actor_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4)',[row.member_id,'auth.login','account',row.id]);return {...session,account:{id:row.id,memberId:row.member_id,name:row.name,email:row.email,roleId:row.role_id}}} finally {client.release()}
    },
    async authenticate(req) {
      const token = cookies(req).orbit_session;
      if (!token) return null;
      const result = await pool.query(`SELECT a.id,a.member_id,a.email,a.role_id,u.name,s.expires_at FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN users u ON u.id=a.member_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND a.active=true`, [tokenHash(token)]);
      const row=result.rows[0];if(!row)return null;
      await pool.query('UPDATE sessions SET last_seen_at=NOW() WHERE token_hash=$1',[tokenHash(token)]);
      return {id:row.id,memberId:row.member_id,name:row.name,email:row.email,roleId:row.role_id,expiresAt:row.expires_at};
    },
    async listAccounts() {
      const result=await pool.query('SELECT a.id,a.member_id "memberId",a.email,a.role_id "roleId",a.active,u.name FROM accounts a JOIN users u ON u.id=a.member_id ORDER BY u.name');
      return result.rows;
    },
    async createAccount({memberId,email,password,roleId}) {
      if(!memberId||!/^\S+@\S+\.\S+$/.test(email||'')||String(password).length<10||!['admin','member','viewer'].includes(roleId)){const error=new Error('Informe pessoa, e-mail, papel e senha temporária com 10 caracteres.');error.statusCode=400;throw error}
      const member=await pool.query('SELECT id,name FROM users WHERE id=$1 AND active=true',[memberId]);if(!member.rowCount){const error=new Error('Pessoa não encontrada.');error.statusCode=404;throw error}
      const accountId=`acc_${crypto.randomUUID()}`,passwordHash=await hashPassword(password);
      try{await pool.query('INSERT INTO accounts(id,member_id,email,password_hash,role_id) VALUES($1,$2,$3,$4,$5)',[accountId,memberId,email.trim().toLowerCase(),passwordHash,roleId]);await pool.query('UPDATE users SET role_id=$1 WHERE id=$2',[roleId,memberId]);return{id:accountId,memberId,email:email.trim().toLowerCase(),roleId,active:true,name:member.rows[0].name}}catch(error){if(error.code==='23505'){error.message='Essa pessoa ou e-mail já possui uma conta.';error.statusCode=409}throw error}
    },
    async updateRole(accountId,roleId) {if(!['admin','member','viewer'].includes(roleId)){const error=new Error('Papel inválido.');error.statusCode=400;throw error}const result=await pool.query('UPDATE accounts SET role_id=$1,updated_at=NOW() WHERE id=$2 RETURNING member_id',[roleId,accountId]);if(!result.rowCount){const error=new Error('Conta não encontrada.');error.statusCode=404;throw error}await pool.query('UPDATE users SET role_id=$1 WHERE id=$2',[roleId,result.rows[0].member_id]);return{ok:true}},
    async deactivate(accountId,currentAccountId) {if(accountId===currentAccountId){const error=new Error('Você não pode desativar sua própria conta.');error.statusCode=400;throw error}const result=await pool.query('UPDATE accounts SET active=false,updated_at=NOW() WHERE id=$1 RETURNING id',[accountId]);if(!result.rowCount){const error=new Error('Conta não encontrada.');error.statusCode=404;throw error}await pool.query('DELETE FROM sessions WHERE account_id=$1',[accountId]);return{ok:true}},
    async logout(req) {const token=cookies(req).orbit_session;if(token)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(token)])},
    cookie(token, expires) {return `orbit_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secureCookies?'; Secure':''}`},
    clearCookie() {return `orbit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies?'; Secure':''}`},
    async close() {await pool.end()},
  };
}

function initials(name) {const parts=name.trim().split(/\s+/);return (parts[0][0]+(parts.at(-1)?.[0]||'')).toUpperCase()}

module.exports = { createAuth, hashPassword, verifyPassword };
