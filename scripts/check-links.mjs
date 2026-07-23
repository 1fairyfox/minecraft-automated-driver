#!/usr/bin/env node
// check-links.mjs — doc-drift gate (repo-hygiene standard). Zero dependencies.
//
// Walks every tracked *.md (minus generated/vendored trees) and fails on any RELATIVE
// link whose target file doesn't exist. Wire into the test gate + CI so a rename/move/
// removal that leaves a dangling link turns the build red. Adapt SKIP to your repo.
//
//   node scripts/check-links.mjs      → exit 1 (and a list) on any broken link
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

// Repo adaptation (per the header note): notes/reference/ holds VERBATIM copies of hub
// standards whose relative cross-links are hub-tree-relative (../templates/…) — valid at
// the hub, dangling here by design. Skip them; project-authored notes stay checked.
const SKIP = [/(^|\/)node_modules\//, /(^|\/)_site\//, /(^|\/)vendor\//, /(^|\/)assets\/references\//, /(^|\/)notes\/reference\//];
const files = execSync("git ls-files *.md **/*.md", { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !SKIP.some((re) => re.test(f)));

const LINK = /\[[^\]]*\]\(([^)]+)\)/g;   // [text](target)
let broken = 0;

for (const file of files) {
  const text = execSync(`git show HEAD:"${file}"`, { encoding: "utf8" });
  for (const m of text.matchAll(LINK)) {
    let target = m[1].trim().split(/\s+/)[0];          // drop optional "title"
    if (/^(https?:|mailto:|tel:|#|data:)/i.test(target)) continue;  // external / same-page
    target = target.replace(/[#?].*$/, "");            // strip fragment/query
    if (!target) continue;
    let path = target.startsWith("/") ? join(".", target) : resolve(dirname(file), target);
    if (existsSync(path)) continue;
    if (existsSync(path + ".md") || (existsSync(path) && statSync(path).isDirectory())) continue;
    console.error(`BROKEN  ${file}  ->  ${m[1]}`);
    broken++;
  }
}

if (broken) { console.error(`\n${broken} broken link(s).`); process.exit(1); }
console.log(`check-links: ${files.length} files OK`);
