const assert = require('node:assert/strict');
process.env.INTEGRATION_ENCRYPTION_KEY = 'chave-de-teste-comprida-e-isolada';
const { encrypt, decrypt } = require('../src/secret-vault');
const cipher = encrypt('segredo sensível');
assert.match(cipher, /^v1\./);
assert.equal(decrypt(cipher), 'segredo sensível');
assert.equal(decrypt(`${cipher}corrompido`), null);
console.log('Cofre AES-256-GCM validado.');
