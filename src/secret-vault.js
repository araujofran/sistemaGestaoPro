const crypto = require('node:crypto');
const config = require('./config');

const key = () => crypto.createHash('sha256').update(config.integrationEncryptionKey || 'orbit-development-only').digest();

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decrypt(payload) {
  if (!payload?.startsWith('v1.')) return null;
  try { const [, iv, tag, data] = payload.split('.'), decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url')); decipher.setAuthTag(Buffer.from(tag, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8'); } catch { return null; }
}

module.exports = { encrypt, decrypt };
