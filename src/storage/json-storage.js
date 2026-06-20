const fs = require('node:fs');

function createJsonStorage({ file, seed }) {
  function ensure() {
    fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(seed(), null, 2));
  }

  return {
    async initialize() { ensure(); },
    async getState() { ensure(); return JSON.parse(fs.readFileSync(file, 'utf8')); },
    async saveState(state, expectedVersion) {
      ensure();
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number(expectedVersion) !== Number(current.meta?.version || 0)) {
        const error = new Error('Os dados foram atualizados por outra pessoa. Recarregue a página.');
        error.statusCode = 409;
        throw error;
      }
      state.meta = { ...(state.meta || {}), updatedAt: new Date().toISOString(), version: expectedVersion + 1 };
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(state, null, 2));
      fs.renameSync(temp, file);
      return state;
    },
    async reset() {
      ensure();
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      const state = seed();
      state.meta.version = Number(current.meta?.version || 0) + 1;
      state.meta.updatedAt = new Date().toISOString();
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(state, null, 2));
      fs.renameSync(temp, file);
      return state;
    },
    async close() {},
  };
}

module.exports = { createJsonStorage };
