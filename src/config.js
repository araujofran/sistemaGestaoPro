const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const storageDriver = (process.env.STORAGE_DRIVER || 'json').toLowerCase();
if (!['json', 'postgres'].includes(storageDriver)) {
  throw new Error('STORAGE_DRIVER deve ser "json" ou "postgres"');
}
if (storageDriver === 'postgres' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL é obrigatória quando STORAGE_DRIVER=postgres');
}

module.exports = {
  port: Number(process.env.PORT || 4173),
  storageDriver,
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  nodeEnv: process.env.NODE_ENV || 'development',
  aiProvider: (process.env.AI_PROVIDER || 'local').toLowerCase(),
  aiApiKey: process.env.GEMINI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gemini-2.5-flash',
  aiBaseUrl: process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
  githubRepository: process.env.GITHUB_REPOSITORY || 'araujofran/sistemaGestaoPro',
  githubToken: process.env.GITHUB_TOKEN || '',
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  integrationEncryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY || process.env.SESSION_SECRET || '',
};
