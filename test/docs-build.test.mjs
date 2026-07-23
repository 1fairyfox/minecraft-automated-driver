// Docs-site build layer: the site is a release artifact, so its assembly is tested
// like one. Regression coverage for the shell-comment substitution bug (2026-07-22):
// page content must appear exactly once per page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, renderChangelog } from '../scripts/build-docs.mjs';

test('docs site builds every page, resolves every placeholder, inserts content exactly once', async () => {
  const out = await mkdtemp(join(tmpdir(), 'docs-site-'));
  try {
    const result = await buildSite({ out });
    assert.equal(result.pages, 9);

    // Chrome assets + .nojekyll present at the root.
    const rootFiles = await readdir(out);
    for (const f of ['main.css', 'fox.png', 'icon.png', 'nav.js', 'reader.js', 'coins.js', '.nojekyll', 'index.html']) {
      assert.ok(rootFiles.includes(f), `missing root asset: ${f}`);
    }

    // The favicon is the PROJECT icon (assets/icon.png), not the fox brand placeholder.
    const [icon, fox] = await Promise.all([
      readFile(join(out, 'icon.png')),
      readFile(join(out, 'fox.png')),
    ]);
    assert.ok(!icon.equals(fox), 'icon.png is still the fox.png placeholder');

    const pages = [
      'index.html', 'roadmap.html', 'security.html', 'changelog.html', 'downloads.html',
      'legal/index.html', 'legal/privacy/index.html', 'legal/terms/index.html', 'legal/cookies/index.html',
    ];
    for (const p of pages) {
      const html = await readFile(join(out, p), 'utf8');
      assert.equal((html.match(/\{\{[A-Z_]+\}\}/g) ?? []).length, 0, `unresolved placeholder in ${p}`);
      assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `content not inserted exactly once in ${p}`);
      assert.match(html, /site-header/, `theme header missing in ${p}`);
      assert.match(html, /site-footer/, `theme footer missing in ${p}`);
      // Anchored to the literal href attribute — asserts the real link target, and is
      // not a bare-URL pattern (CodeQL js/regex/missing-regexp-anchor, alerts #5–6).
      assert.ok(html.includes('href="https://fairyfox.io/"'), `fairyfox back-link missing in ${p}`);
      assert.ok(html.includes('href="https://github.com/1fairyfox/minecraft-automated-driver"'), `repo link missing in ${p}`);
    }

    // Changelog is generated from the notes and carries every release exactly once.
    const changelog = await readFile(join(out, 'changelog.html'), 'utf8');
    for (const v of ['0.1.0', '0.1.1', '0.1.2']) {
      assert.ok(changelog.includes(v), `changelog missing ${v}`);
    }
    // Structural marker, not prose (prose can legitimately recur inside changelog
    // entries — bitten 2026-07-23): the generated intro paragraph exists exactly once.
    assert.equal(
      (changelog.match(/<p class="pg-meta">Generated from the repository/g) ?? []).length,
      1,
      'changelog body duplicated',
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('renderChangelog strips the per-month markdown headings and keeps release h2s', async () => {
  const html = await renderChangelog();
  assert.ok(!/Changelog — \d{4}-\d{2}/.test(html), 'per-month heading leaked into the page');
  assert.match(html, /<h2[^>]*>0\.1\.0/, 'release heading missing');
});
