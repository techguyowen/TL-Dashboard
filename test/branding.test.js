const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const IGNORED_DIRS = new Set(['.agents', 'node_modules', '.git', 'test']);
const IGNORED_FILES = new Set(['ORIGINAL_REQUEST.md', 'PROJECT.md', 'TEST_INFRA.md']);

test('Branding: verifies presence of TL Auction Tracker branding in key files', () => {
  const targetDomain = 'triangleliquidators.com';
  const keyFiles = ['server.js', 'package.json', 'README.md', 'public/index.html', 'catalog_cache.json'];

  for (const relPath of keyFiles) {
    const fullPath = path.join(ROOT_DIR, relPath);
    assert.strictEqual(fs.existsSync(fullPath), true, `File should exist: ${relPath}`);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.strictEqual(
      content.includes(targetDomain) || content.includes('bid.triangleliquidators.com') || content.includes('auction.triangleliquidators.com') || content.includes('TL Auction') || content.includes('tl-auction') || content.includes('TL Live'),
      true,
      `File ${relPath} must contain TL Auction branding reference`
    );
  }
});
