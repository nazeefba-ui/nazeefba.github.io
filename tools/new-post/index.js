#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const matter = require('gray-matter');
const { marked } = require('marked');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const ARTICLES_DIR = path.join(REPO_ROOT, 'articles');
const SITEMAP_PATH = path.join(REPO_ROOT, 'sitemap.xml');
const SITE_URL = 'https://nazeefba.com';

const CATEGORY_LABELS = {
  academic: 'Academic',
  opinion: 'Opinion',
  scicomm: 'Science comm.'
};

function fail(message) {
  console.error('Error: ' + message);
  process.exit(1);
}

function slugify(t) {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
}

function todayFormatted() {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function deriveExcerpt(bodyHtml) {
  const firstParagraph = bodyHtml.match(/<p>([\s\S]*?)<\/p>/);
  const text = stripTags(firstParagraph ? firstParagraph[1] : bodyHtml);
  if (text.length <= 220) return text;
  const cut = text.slice(0, 220);
  const lastSpace = cut.lastIndexOf(' ');
  return cut.slice(0, lastSpace > 0 ? lastSpace : 220).trim() + '…';
}

function deriveReadTime(bodyHtml) {
  const words = stripTags(bodyHtml).split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return minutes + ' min read';
}

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (const a of argv) {
    if (a.startsWith('--')) args.flags[a.slice(2)] = true;
    else args.positional.push(a);
  }
  return args;
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const inputArg = positional[0];
  if (!inputArg) {
    console.log('Usage: node tools/new-post/index.js <path-to-draft.md> [--force] [--no-git]');
    console.log('  --force   overwrite an existing article with the same slug');
    console.log('  --no-git  write the files but skip git add/commit/push');
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  if (!fs.existsSync(inputPath)) fail('draft not found: ' + inputPath);

  const raw = fs.readFileSync(inputPath, 'utf8');
  const { data, content } = matter(raw);

  if (!data.title || !String(data.title).trim()) fail('front matter is missing "title"');
  const category = String(data.category || '').trim().toLowerCase();
  if (!CATEGORY_LABELS[category]) {
    fail('front matter "category" must be one of: ' + Object.keys(CATEGORY_LABELS).join(', '));
  }
  if (!content.trim()) fail('the draft has no body content');

  const title = String(data.title).trim();
  const slug = slugify(data.slug ? String(data.slug) : title);
  if (!slug) fail('could not derive a slug from the title; set "slug" explicitly in front matter');

  const date = data.date ? String(data.date).trim() : todayFormatted();
  const image = data.image ? String(data.image).trim() : '';
  const bodyHtml = marked.parse(content.trim());
  const excerpt = data.excerpt ? String(data.excerpt).trim() : deriveExcerpt(bodyHtml);
  const readTime = data.readTime ? String(data.readTime).trim() : deriveReadTime(bodyHtml);

  if (!fs.existsSync(INDEX_PATH)) fail('index.html not found at ' + INDEX_PATH);
  const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');

  const arrayMatch = indexHtml.match(/const writings=(\[.*?\]);/s);
  if (!arrayMatch) fail('could not find "const writings=[...]" in index.html');

  let writings;
  try {
    writings = JSON.parse(arrayMatch[1]);
  } catch (e) {
    fail('failed to parse the writings array in index.html as JSON: ' + e.message);
  }

  const existing = writings.find((w) => w.slug === slug);
  if (existing && !flags.force) {
    fail('an article with slug "' + slug + '" already exists (id ' + existing.id + '). Use --force to overwrite it.');
  }

  const nextId = existing ? existing.id : writings.reduce((max, w) => Math.max(max, w.id), 0) + 1;

  const newEntry = {
    id: nextId,
    slug,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    date,
    title,
    excerpt,
    readTime,
    image,
    body: bodyHtml
  };

  const newWritings = existing
    ? writings.map((w) => (w.slug === slug ? newEntry : w))
    : [newEntry, ...writings];

  const updatedIndexHtml = indexHtml.replace(
    arrayMatch[0],
    'const writings=' + JSON.stringify(newWritings) + ';'
  );
  fs.writeFileSync(INDEX_PATH, updatedIndexHtml);

  const articleHtml = buildArticlePage(updatedIndexHtml, { title, slug, excerpt, date, image });
  if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  const articlePath = path.join(ARTICLES_DIR, slug + '.html');
  fs.writeFileSync(articlePath, articleHtml);

  fs.writeFileSync(SITEMAP_PATH, buildSitemap(newWritings));

  console.log((existing ? 'Updated' : 'Published') + ' article: ' + title);
  console.log('  slug:     ' + slug);
  console.log('  category: ' + CATEGORY_LABELS[category]);
  console.log('  date:     ' + date);
  console.log('  files:    index.html, articles/' + slug + '.html, sitemap.xml');

  if (flags['no-git']) {
    console.log('\n--no-git set: files were written but not committed. Review and commit/push yourself.');
    return;
  }

  runGit(['add', 'index.html', 'articles/' + slug + '.html', 'sitemap.xml']);
  const verb = existing ? 'Update' : 'Add';
  runGit(['commit', '-m', verb + ' article: ' + title]);
  runGit(['push']);
  console.log('\nPushed. GitHub Pages will redeploy automatically.');
}

function buildSitemap(writings) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: SITE_URL + '/', priority: '1.0' },
    ...writings.map((w) => ({ loc: SITE_URL + '/articles/' + w.slug + '.html', priority: '0.8' }))
  ];
  const entries = urls
    .map((u) => '  <url>\n    <loc>' + u.loc + '</loc>\n    <lastmod>' + today + '</lastmod>\n    <priority>' + u.priority + '</priority>\n  </url>')
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + entries + '\n</urlset>\n';
}

function buildArticlePage(indexHtml, meta) {
  const url = 'https://nazeefba.com/articles/' + meta.slug + '.html';
  const image = meta.image
    ? (meta.image.startsWith('http') ? meta.image : 'https://nazeefba.com/' + meta.image.replace(/^\//, ''))
    : 'https://nazeefba.com/images/og-default.jpg';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let html = indexHtml;

  html = html.replace(
    /<title>.*?<\/title>/s,
    '<title>' + esc(meta.title) + ' — The Thinking Specimen</title>'
  );

  const metaBlockRe = /<meta name="description"[\s\S]*?<meta name="twitter:image"[^>]*>\n?/;
  const newMetaBlock =
    '<meta name="description" content="' + esc(meta.excerpt) + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:site_name" content="The Thinking Specimen">\n' +
    '<meta property="og:title" content="' + esc(meta.title) + '">\n' +
    '<meta property="og:description" content="' + esc(meta.excerpt) + '">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta property="og:image" content="' + image + '">\n' +
    '<meta property="article:author" content="Nazeef">\n' +
    '<meta property="article:published_time" content="' + esc(meta.date) + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + esc(meta.title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(meta.excerpt) + '">\n' +
    '<meta name="twitter:image" content="' + image + '">\n' +
    '<link rel="canonical" href="' + url + '">\n';

  if (!metaBlockRe.test(html)) fail('could not locate the meta tag block in index.html to template from');
  html = html.replace(metaBlockRe, newMetaBlock);

  const autoOpenScript =
    '<script>\n' +
    "window.currentArticleSlug = '" + meta.slug.replace(/'/g, "\\'") + "';\n" +
    'document.addEventListener(\'DOMContentLoaded\', function () {\n' +
    "  var w = writings.find(function (x) { return x.slug === '" + meta.slug.replace(/'/g, "\\'") + "'; });\n" +
    '  if (w) openArticleView(w);\n' +
    '});\n' +
    '</script>\n';

  html = html.replace('</body>', autoOpenScript + '</body>');
  return html;
}

function runGit(args) {
  console.log('$ git ' + args.join(' '));
  execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

main();
