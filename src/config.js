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
};
