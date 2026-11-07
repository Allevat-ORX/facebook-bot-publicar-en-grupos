const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('dockerignore excludes operational data and sensitive agent artifacts', () => {
  const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
  for (const pattern of [
    'data/',
    'cola.json',
    'catalogo_grupos.json',
    '*.log',
    '*.png',
    'error-*.png',
    'facebook-session/',
    'sessions/',
    'session-profile2/',
    '.superpowers/',
    '.git/',
    '.env*',
    '*credentials*',
    '*.pem',
    '*.key',
    'credentials/',
    'keys/',
  ]) {
    assert.ok(dockerignore.split(/\r?\n/).includes(pattern), pattern);
  }
  assert.match(fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8'), /COPY \. \./);
});
