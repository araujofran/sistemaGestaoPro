const path = require('node:path');
const { storageDriver, databaseUrl, databaseSsl } = require('../config');
const { createJsonStorage } = require('./json-storage');
const { createPostgresStorage } = require('./postgres-storage');

function createStorage({ seed }) {
  if (storageDriver === 'postgres') {
    return createPostgresStorage({ connectionString: databaseUrl, ssl: databaseSsl, seed });
  }
  return createJsonStorage({ file: path.join(__dirname, '..', '..', 'data', 'state.json'), seed });
}

module.exports = { createStorage };
