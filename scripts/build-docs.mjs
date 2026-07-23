#!/usr/bin/env node
// build-docs.mjs — assemble the themed docs site (docs-site standard, Case A).
//
// Fills docs-theme/pages/_shell.html placeholders for every page in PAGES, renders the
// changelog page live from notes/version/*.md (never stale), copies the vendored chrome
// assets, and writes the whole site to dist/docs-site/ for the Pages workflow.
//
//   node scripts/build-docs.mjs        → dist/docs-site/
//
// Fails loudly on any unresolved {{PLACEHOLDER}} left in an output file.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const THEME = join(ROOT, 'docs-theme');
const OUT = join(ROOT, 'dist', 'docs-site');

// Page registry: output path → { content source, title, desc, active subnav key,
// readable (reader typography on) }. Depth (for {{FF_ROOT}}) derives from the path.
const PAGES = [
  { out: 'index.html', src: 'index.html', active: 'OVERVIEW', home: true, read: false,
    title: 'Minecraft Automated Driver — the Minecraft dev loop behind one MCP server',
    desc: 'An MCP server for building, testing, launching, attaching to, and semantically driving live Minecraft clients and servers.' },
  { out: 'roadmap.html', src: 'roadmap.html', active: 'ROADMAP', read: true,
    title: 'Roadmap — Minecraft Automated Driver',
    desc: 'The layer model, the instance/attach design, and Phases 0–8.' },
  { out: 'security.html', src: 'security.html', active: 'SECURITY', read: true,
    title: 'Security model — Minecraft Automated Driver',
    desc: 'Stdio-only MCP, loopback-only control plane, agents disabled by default, GitHub-only distribution.' },
  { out: 'changelog.html', src: null, active: 'CHANGELOG', read: true,
    title: 'Changelog — Minecraft Automated Driver',
    desc: 'Every release, in plain English, newest first.' },
  { out: 'downloads.html', src: 'downloads.html', active: 'DOWNLOAD', read: false,
    title: 'Download — Minecraft Automated Driver',
    desc: 'GitHub Releases — the only distribution channel, deliberately.' },
  { out: 'legal/index.html', src: 'legal/index.html', active: 'LEGAL', read: false,
    title: 'Legal — Minecraft Automated Driver',
    desc: 'Privacy, terms, and cookies — written to match what the software actually does.' },
  { out: 'legal/privacy/index.html', src: 'legal/privacy.html', active: 'LEGAL', read: true,
    title: 'Privacy Policy — Minecraft Automated Driver',
    desc: 'What is (and is not) collected by this site and by the driver on your machine.' },
  { out: 'legal/terms/index.html', src: 'legal/terms.html', active: 'LEGAL', read: true,
    title: 'Terms & Conditions — Minecraft Automated Driver',
    desc: 'Apache-2.0, "as is" provision, and your responsibilities.' },
  { out: 'legal/cookies/index.html', src: 'legal/cookies.html', active: 'LEGAL', read: true,
    title: 'Cookies Policy — Minecraft Automated Driver',
    desc: 'No cookies; what lives in local storage and how to clear it.' },
];

const ACTIVE_KEYS = ['OVERVIEW', 'ROADMAP', 'SECURITY', 'CHANGELOG', 'DOWNLOAD', 'LEGAL'];
const ACTIVE_ATTR = ' class="active" aria-current="page"';

export async function renderChangelog(root = ROOT) {
  const dir = join(root, 'notes', 'version');
  const months = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}\.md$/.test(f)).sort().reverse();
  let md = '';
  for (const m of months) md += (await readFile(join(dir, m), 'utf8')) + '\n';
  // Drop the per-file "# Changelog — YYYY-MM" headings; the page provides the h1.
  md = md.replace(/^# Changelog[^\n]*\n/gm, '');
  return '<h1>Changelog</h1>\n<p class="pg-meta">Generated from the repository\'s ' +
    'living changelog (<code>notes/version/</code>) at build time — never stale.</p>\n' +
    marked.parse(md);
}

export async function buildSite({ root = ROOT, out = OUT } = {}) {
  const shell = await readFile(join(THEME, 'pages', '_shell.html'), 'utf8');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // Vendored chrome assets at the site root (paths the shell references via FF_ROOT).
  for (const a of ['main.css', 'fox.png', 'nav.js', 'reader.js', 'coins.js']) {
    await cp(join(THEME, 'chrome', a), join(out, a));
  }
  // The project icon (owner art, 2026-07-23) — the site favicon. Hard requirement:
  // build fails if it's missing rather than silently shipping the wrong brand.
  await cp(join(root, 'assets', 'icon.png'), join(out, 'icon.png'));
  await writeFile(join(out, '.nojekyll'), '');

  for (const page of PAGES) {
    const depth = page.out.split('/').length - 1;
    const ffRoot = '../'.repeat(depth);
    const content = page.src === null
      ? await renderChangelog(root)
      : await readFile(join(THEME, 'pages', 'content', page.src), 'utf8');

    let html = shell
      .replaceAll('{{FF_ROOT}}', ffRoot)
      .replaceAll('{{FF_HTML_ATTRS}}', page.read ? ' data-read' : '')
      .replaceAll('{{FF_TITLE}}', page.title)
      .replaceAll('{{FF_DESC}}', page.desc)
      .replaceAll('{{FF_CONTENT}}', content)
      .replaceAll('{{ACTIVE_HOME}}', page.home ? ACTIVE_ATTR : '')
      .replaceAll('{{ARIA_HOME}}', '');
    for (const key of ACTIVE_KEYS) {
      html = html.replaceAll(`{{ACTIVE_${key}}}`, page.active === key ? ACTIVE_ATTR : '');
    }

    const leftover = html.match(/\{\{[A-Z_]+\}\}/);
    if (leftover) throw new Error(`Unresolved placeholder ${leftover[0]} in ${page.out}`);

    await mkdir(dirname(join(out, page.out)), { recursive: true });
    await writeFile(join(out, page.out), html);
  }
  return { pages: PAGES.length, out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { pages, out } = await buildSite();
  console.log(`build-docs: ${pages} pages → ${out}`);
}
