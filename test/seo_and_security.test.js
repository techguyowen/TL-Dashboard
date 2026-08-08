const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const httpMock = require('node:http');
const { app } = require('../server.js');

test('SEO & Security: robots.txt blocks AI scrapers and allows search engines', () => {
  const robotsPath = path.join(__dirname, '../public/robots.txt');
  assert.strictEqual(fs.existsSync(robotsPath), true, 'robots.txt should exist');

  const content = fs.readFileSync(robotsPath, 'utf8');
  assert.strictEqual(content.includes('User-agent: GPTBot'), true, 'Should disallow GPTBot');
  assert.strictEqual(content.includes('User-agent: ClaudeBot'), true, 'Should disallow ClaudeBot');
  assert.strictEqual(content.includes('User-agent: PerplexityBot'), true, 'Should disallow PerplexityBot');
  assert.strictEqual(content.includes('User-agent: Bytespider'), true, 'Should disallow Bytespider');
  assert.strictEqual(content.includes('User-agent: *'), true, 'Should include default user-agent rule');
  assert.strictEqual(content.includes('Sitemap: https://auction.triangleliquidators.com/sitemap.xml'), true, 'Should link to sitemap.xml');
});

test('SEO & Security: static SEO files exist (sitemap.xml, llms.txt, site.webmanifest, 404.html)', () => {
  assert.strictEqual(fs.existsSync(path.join(__dirname, '../public/sitemap.xml')), true, 'sitemap.xml must exist');
  assert.strictEqual(fs.existsSync(path.join(__dirname, '../public/llms.txt')), true, 'llms.txt must exist');
  assert.strictEqual(fs.existsSync(path.join(__dirname, '../public/site.webmanifest')), true, 'site.webmanifest must exist');
  assert.strictEqual(fs.existsSync(path.join(__dirname, '../public/404.html')), true, '404.html must exist');
});

test('SEO & HTML Structure: index.html contains essential metadata, JSON-LD, single H1, and noscript tag', () => {
  const indexPath = path.join(__dirname, '../public/index.html');
  assert.strictEqual(fs.existsSync(indexPath), true, 'public/index.html must exist');

  const html = fs.readFileSync(indexPath, 'utf8');

  // Check meta description
  assert.strictEqual(html.includes('<meta name="description"'), true, 'Must contain meta description');

  // Check canonical link
  assert.strictEqual(html.includes('<link rel="canonical"'), true, 'Must contain canonical link');

  // Check OpenGraph tags
  assert.strictEqual(html.includes('<meta property="og:title"'), true, 'Must contain og:title');

  // Check JSON-LD
  assert.strictEqual(html.includes('application/ld+json'), true, 'Must contain JSON-LD structured data');

  // Check single H1 tag
  const h1Matches = html.match(/<h1[\s>]/g) || [];
  assert.strictEqual(h1Matches.length, 1, 'Must contain exactly 1 <h1> tag');
  assert.strictEqual(html.includes('<h1 class="brand-title">'), true, 'H1 tag must be the primary header');

  // Check noscript fallback
  assert.strictEqual(html.includes('<noscript>'), true, 'Must contain noscript fallback');
});

test('Express Server: Returns 404 for unknown routes', async () => {
  const req = new httpMock.IncomingMessage();
  req.method = 'GET';
  req.url = '/some-nonexistent-path-123';
  req.headers = { host: 'localhost' };

  let statusCode = 200;
  let sentFile = null;

  const res = new httpMock.ServerResponse(req);
  res.status = function(code) {
    statusCode = code;
    return this;
  };
  res.sendFile = function(filePath) {
    sentFile = filePath;
    this.emit('finish');
  };

  await new Promise(resolve => {
    res.on('finish', resolve);
    app.handle(req, res);
  });

  assert.strictEqual(statusCode, 404, 'Status code should be 404');
  assert.strictEqual(sentFile.includes('404.html'), true, 'Should render 404.html');
});
