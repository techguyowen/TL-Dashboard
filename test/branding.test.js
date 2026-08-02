const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const IGNORED_DIRS = new Set(['.agents', 'node_modules', '.git', 'test']);
const IGNORED_FILES = new Set(['ORIGINAL_REQUEST.md', 'PROJECT.md', 'TEST_INFRA.md']);

test('Branding: verifies presence of Triangle Liquidators domain in key files', () => {
  const targetDomain = 'auction.triangleliquidators.com';
  const keyFiles = ['server.js', 'package.json', 'README.md', 'public/index.html', 'catalog_cache.json'];

  for (const relPath of keyFiles) {
    const fullPath = path.join(ROOT_DIR, relPath);
    assert.strictEqual(fs.existsSync(fullPath), true, `File should exist: ${relPath}`);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.strictEqual(
      content.includes(targetDomain) || content.includes('triangleliquidators') || content.includes('Triangle Liquidators'),
      true,
      `File ${relPath} must contain Triangle Liquidators domain or reference`
    );
  }
});
