// One-off migration: WordPress database + wp-source/ files -> Astro content, data and images.
//
//   scripts/db.sh            # load the SQL dump into a local MariaDB container
//   node scripts/export.mjs  # regenerate src/content, src/data/site.json and public/wp-content
//
// Everything this writes is committed, so the site builds without the WordPress source material.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import sharp from 'sharp';
import { unserialize } from 'php-serialize';
import { autop } from '@wordpress/autop';
import { decodeHTML } from 'entities';

const ROOT = path.resolve(import.meta.dirname, '..');
const WP = path.join(ROOT, 'wp-source');
const UPLOADS_SRC = path.join(WP, 'wp-content/uploads');
const TUMBLR_SRC = path.join(WP, 'tumblr');
const UPLOADS_OUT = path.join(ROOT, 'public/wp-content/uploads');
const PREFIX = 'tQfwtqLw';

// Images wider than this are downsized; anything heavier than MAX_BYTES is re-encoded as WebP.
const MAX_WIDTH = 2048;
const MAX_BYTES = 300 * 1024;

const db = await mysql.createConnection({
  host: '127.0.0.1', port: 3307, user: 'root', password: 'root', database: 'sj', dateStrings: true,
});
const query = async (sql, params) => (await db.query(sql, params))[0];
const option = async (name) =>
  (await query(`select option_value v from ${PREFIX}options where option_name=?`, [name]))[0]?.v;

// ---------------------------------------------------------------------------------------------
// Attachments

const attachments = new Map();
for (const row of await query(
  `select p.ID, p.post_parent, p.post_title, p.post_excerpt, p.menu_order, p.post_mime_type,
          max(if(m.meta_key='_wp_attached_file', m.meta_value, null)) file,
          max(if(m.meta_key='_wp_attachment_metadata', m.meta_value, null)) meta,
          max(if(m.meta_key='_wp_attachment_image_alt', m.meta_value, null)) alt
     from ${PREFIX}posts p left join ${PREFIX}postmeta m on m.post_id=p.ID
    where p.post_type='attachment' group by p.ID`,
)) {
  let meta = {};
  try { meta = row.meta ? unserialize(row.meta) : {}; } catch { /* corrupt metadata: treat as none */ }
  attachments.set(row.ID, { ...row, meta });
}

// ---------------------------------------------------------------------------------------------
// Image pipeline

const processed = new Map(); // source rel path -> public URL
const stats = { copied: 0, converted: 0, fallback: [], missing: [] };

// WordPress never stored some >10MB originals on this host; use the largest resized variant instead.
async function resolveSource(rel) {
  const direct = path.join(UPLOADS_SRC, rel);
  if (existsSync(direct)) return direct;
  const { dir, name, ext } = path.parse(rel);
  const folder = path.join(UPLOADS_SRC, dir);
  if (!existsSync(folder)) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variant = new RegExp(`^${escaped}-(\\d+)x(\\d+)${ext.replace('.', '\\.')}$`);
  const candidates = (await fs.readdir(folder))
    .map((f) => ({ f, m: f.match(variant) }))
    .filter((c) => c.m)
    .sort((a, b) => b.m[1] * b.m[2] - a.m[1] * a.m[2]);
  if (!candidates.length) return null;
  stats.fallback.push(rel);
  return path.join(folder, candidates[0].f);
}

async function emit(source, outRel, maxWidth = MAX_WIDTH) {
  const isRaster = /\.(png|jpe?g)$/i.test(source);
  const size = (await fs.stat(source)).size;
  let width = 0;
  if (isRaster) width = (await sharp(source).metadata()).width ?? 0;

  const convert = isRaster && (size > MAX_BYTES || width > maxWidth);
  const finalRel = convert ? outRel.replace(/\.[^.]+$/, '.webp') : outRel;
  const dest = path.join(UPLOADS_OUT, finalRel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (convert) {
    await sharp(source).rotate().resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: 82 }).toFile(dest);
    stats.converted++;
  } else {
    await fs.copyFile(source, dest);
    stats.copied++;
  }
  return '/wp-content/uploads/' + finalRel.split(path.sep).join('/');
}

async function uploadUrl(rel, maxWidth) {
  rel = decodeURIComponent(rel);
  const key = `${rel}@${maxWidth ?? ''}`;
  if (processed.has(key)) return processed.get(key);
  const source = await resolveSource(rel);
  if (!source) {
    stats.missing.push(rel);
    processed.set(key, '/wp-content/uploads/' + rel);
    return processed.get(key);
  }
  const outRel = maxWidth ? rel.replace(/(\.[^.]+)$/, `-w${maxWidth}$1`) : rel;
  const url = await emit(source, outRel, maxWidth);
  processed.set(key, url);
  return url;
}

async function tumblrUrl(basename) {
  const key = `tumblr/${basename}`;
  if (processed.has(key)) return processed.get(key);
  const source = path.join(TUMBLR_SRC, basename);
  if (!existsSync(source)) {
    stats.missing.push(key);
    return null;
  }
  const url = await emit(source, key);
  processed.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------------------------
// Content rendering (the parts of the_content() this site actually relied on)

const SITE_HOST = String.raw`https?:\/\/(?:www\.)?staffordjazz\.(?:org|infinityfree\.me)`;

async function replaceAsync(text, regex, fn) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(regex)) {
    parts.push(text.slice(last, m.index), fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return (await Promise.all(parts)).join('');
}

// A cut-down wptexturize: curly quotes, dashes and ellipses in text nodes only.
function texturize(html) {
  let skip = 0;
  return html.split(/(<[^>]*>)/).map((chunk) => {
    if (chunk.startsWith('<')) {
      if (/^<(pre|code|script|style|kbd|tt)\b/i.test(chunk)) skip++;
      else if (/^<\/(pre|code|script|style|kbd|tt)\b/i.test(chunk)) skip = Math.max(0, skip - 1);
      return chunk;
    }
    if (skip) return chunk;
    return chunk
      .replace(/\.\.\./g, '…')
      .replace(/---/g, '—')
      .replace(/(^|[\s\u00a0]|&nbsp;)--(?=$|[\s\u00a0]|&nbsp;)/g, '$1—')
      .replace(/--/g, '–')
      .replace(/(^|[\s\u00a0]|&nbsp;)-(?=$|[\s\u00a0]|&nbsp;)/g, '$1–')
      .replace(/(^|[\s(\[{<-])"/g, '$1“')
      .replace(/"/g, '”')
      .replace(/(\d)'(\d\ds?\b)/g, '$1’$2')
      .replace(/(^|[\s(\[{<“-])'(?=\d\ds?\b)/g, '$1’')
      .replace(/(^|[\s(\[{<“-])'/g, '$1‘')
      .replace(/'/g, '’');
  }).join('');
}

function galleryHtml(postId) {
  const items = [...attachments.values()]
    .filter((a) => a.post_parent === postId && a.post_mime_type.startsWith('image/'))
    .sort((a, b) => a.menu_order - b.menu_order || a.ID - b.ID);
  if (!items.length) return '';
  const figures = items.map((a) => {
    const dir = path.posix.dirname(a.file);
    const thumb = a.meta.sizes?.thumbnail;
    const src = thumb ? `${dir}/${thumb.file}` : a.file;
    const w = thumb?.width ?? a.meta.width;
    const h = thumb?.height ?? a.meta.height;
    const orientation = (a.meta.height ?? 0) > (a.meta.width ?? 0) ? 'portrait' : 'landscape';
    const caption = a.post_excerpt
      ? `<figcaption class="wp-caption-text gallery-caption">${a.post_excerpt}</figcaption>` : '';
    return `<figure class="gallery-item"><div class="gallery-icon ${orientation}">`
      + `<a href="https://staffordjazz.org/wp-content/uploads/${a.file}">`
      + `<img width="${w}" height="${h}" src="https://staffordjazz.org/wp-content/uploads/${src}" `
      + `class="attachment-thumbnail size-thumbnail" alt="${escapeAttr(a.alt ?? '')}" loading="lazy" decoding="async"></a>`
      + `</div>${caption}</figure>`;
  });
  return `<div id="gallery-${postId}" class="gallery galleryid-${postId} gallery-columns-3 gallery-size-thumbnail">`
    + figures.join('') + '</div>';
}

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

let legacy; // filled in below: WordPress ID -> new URL

async function renderContent(post) {
  let html = post.post_content.replace(/\r\n/g, '\n');
  const isBlocks = html.includes('<!-- wp:');

  // Dynamic blocks are rendered by the Astro templates, not stored in the content.
  html = html.replace(/<!-- wp:query [\s\S]*?<!-- \/wp:query -->/g, '');

  html = html.replace(/\[gallery[^\]]*\]/g, () => `\n\n${galleryHtml(post.ID)}\n\n`);
  html = html.replace(/<!-- \/?wp:[\s\S]*?-->/g, '');
  if (!isBlocks) html = autop(html);
  html = texturize(html);

  // Internal links
  html = html.replace(new RegExp(`href=(["'])${SITE_HOST}\\/?\\?(?:p|page_id)=(\\d+)\\1`, 'g'),
    (m, q, id) => `href=${q}${legacy[id] ?? '/'}${q}`);
  html = html.replace(new RegExp(`href=(["'])${SITE_HOST}(\\/(?!wp-content)[^"']*)?\\1`, 'g'),
    (m, q, p = '/') => `href=${q}${oldSlugs[p.replace(/^\/|\/$/g, '')] ?? (p.endsWith('/') ? p : p + '/')}${q}`);

  // Links left over from the pre-WordPress Tumblr site
  html = html.replace(/href="\/boty-hof\/?"/g, 'href="/band-hall-of-fame/"')
    .replace(/href="\/moty-hof\/?"/g, 'href="/musician-hall-of-fame/"');

  // Media
  html = await replaceAsync(html, new RegExp(`${SITE_HOST}\\/wp-content\\/uploads\\/([^"'\\s)]+)`, 'g'),
    (m, rel) => uploadUrl(rel));
  html = await replaceAsync(html, /https?:\/\/\d+\.media\.tumblr\.com\/(?:[^"'\s)]*\/)?([^"'\s)/]+)/g,
    async (m, basename) => (await tumblrUrl(basename)) ?? m);

  return html;
}

// Astro treats the body as Markdown. With no blank lines and a block-level wrapper, CommonMark
// passes the whole thing through as one raw HTML block.
const toBody = (html) =>
  `<div class="wp-content">\n${html.replace(/\n\s*\n/g, '\n').replace(/^[ \t]+/gm, '').trim()}\n</div>\n`;

function excerpt(html) {
  const text = decodeHTML(html.replace(/<(figure|script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
  const words = text.split(' ');
  return words.length > 55 ? words.slice(0, 55).join(' ') + '…' : text;
}

const yaml = (obj, indent = '') => Object.entries(obj)
  .filter(([, v]) => v !== undefined && v !== null)
  .map(([k, v]) => (typeof v === 'object'
    ? `${indent}${k}:\n${yaml(v, indent + '  ')}`
    : `${indent}${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`))
  .join('\n');

// ---------------------------------------------------------------------------------------------
// Load posts and pages, work out URLs

const SKIP_PAGES = new Set(['sample-page']); // untouched WordPress default
const frontPageId = Number(await option('page_on_front'));

const posts = await query(
  `select ID, post_title, post_name, post_date, post_modified, post_content, post_type
     from ${PREFIX}posts where post_status='publish' and post_type in ('post','page')
    order by post_date`,
);

const oldSlugs = {};
legacy = {};
for (const p of posts) {
  if (p.post_type === 'page') {
    p.url = p.ID === frontPageId ? '/' : `/${p.post_name}/`;
  } else {
    const [y, m] = p.post_date.split('-');
    p.url = `/${y}/${m}/${p.post_name}/`;
  }
  legacy[p.ID] = p.url;
  if (p.ID === frontPageId) oldSlugs[p.post_name] = '/';
}
for (const row of await query(`select post_id, meta_value from ${PREFIX}postmeta where meta_key='_wp_old_slug'`)) {
  if (legacy[row.post_id]) oldSlugs[row.meta_value] = legacy[row.post_id];
}
oldSlugs['stafford-jazz-society-general-information'] = '/';

const thumbnails = new Map(
  (await query(`select post_id, meta_value from ${PREFIX}postmeta where meta_key='_thumbnail_id'`))
    .map((r) => [r.post_id, Number(r.meta_value)]),
);

// ---------------------------------------------------------------------------------------------
// Write content

for (const dir of ['src/content/posts', 'src/content/pages', 'public/wp-content/uploads']) {
  await fs.rm(path.join(ROOT, dir), { recursive: true, force: true });
  await fs.mkdir(path.join(ROOT, dir), { recursive: true });
}

let written = 0;
for (const p of posts) {
  if (p.post_type === 'page' && SKIP_PAGES.has(p.post_name)) continue;
  const html = await renderContent(p);

  let featuredImage;
  const thumb = attachments.get(thumbnails.get(p.ID));
  if (thumb) {
    const scale = Math.min(1, 1200 / thumb.meta.width);
    featuredImage = {
      src: await uploadUrl(thumb.file, 1200),
      width: Math.round(thumb.meta.width * scale),
      height: Math.round(thumb.meta.height * scale),
      alt: thumb.alt ?? '',
    };
  }

  const front = {
    title: texturize(decodeHTML(p.post_title)),
    date: p.post_date.replace(' ', 'T'),
    wpId: p.ID,
    ...(p.post_type === 'post' ? { excerpt: excerpt(html) } : {}),
    ...(p.ID === frontPageId ? { latestPosts: 2 } : {}),
    featuredImage,
  };
  const file = p.post_type === 'page'
    ? `src/content/pages/${p.ID === frontPageId ? 'index' : p.post_name}.md`
    : `src/content/posts/${p.post_date.slice(0, 10)}-${p.post_name}.md`;
  await fs.writeFile(path.join(ROOT, file), `---\n${yaml(front)}\n---\n\n${toBody(html)}`);
  written++;
}

// ---------------------------------------------------------------------------------------------
// Site data: identity, logo, menu, legacy URL map

const logo = attachments.get(
  unserialize(await option('theme_mods_twentysixteen')).custom_logo,
);

const menu = [];
for (const item of await query(
  `select p.ID, p.post_title,
          max(if(m.meta_key='_menu_item_object_id', m.meta_value, null)) object_id,
          max(if(m.meta_key='_menu_item_url', m.meta_value, null)) url
     from ${PREFIX}posts p join ${PREFIX}postmeta m on m.post_id=p.ID
    where p.post_type='nav_menu_item' and p.post_status='publish'
    group by p.ID order by p.menu_order`,
)) {
  const target = posts.find((p) => p.ID === Number(item.object_id));
  menu.push({ label: item.post_title || target?.post_title, href: target?.url ?? item.url });
}

const [author] = await query(`select display_name, user_email from ${PREFIX}users where ID=1`);
// Site icon, at the sizes WordPress emits, plus /favicon.ico which browsers request unprompted.
await fs.mkdir(path.join(ROOT, 'public/theme'), { recursive: true });
const iconSource = path.join(UPLOADS_SRC, attachments.get(Number(await option('site_icon'))).file);
for (const size of [32, 180, 192]) {
  await sharp(iconSource).resize(size, size).png().toFile(path.join(ROOT, `public/theme/icon-${size}.png`));
}
const png32 = await sharp(iconSource).resize(32, 32).png().toBuffer();
const ico = Buffer.alloc(22); // ICONDIR + one ICONDIRENTRY wrapping a PNG-encoded image
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7);
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
await fs.writeFile(path.join(ROOT, 'public/favicon.ico'), Buffer.concat([ico, png32]));

await fs.mkdir(path.join(ROOT, 'src/data'), { recursive: true });
await fs.writeFile(path.join(ROOT, 'src/data/site.json'), JSON.stringify({
  title: await option('blogname'),
  description: await option('blogdescription'),
  author: author.display_name,
  logo: logo && { src: await uploadUrl(logo.file), width: logo.meta.width, height: logo.meta.height },
  menu,
}, null, 2) + '\n');
await fs.writeFile(path.join(ROOT, 'src/data/legacy-urls.json'), JSON.stringify(legacy, null, 2) + '\n');

await db.end();

console.log(`content files: ${written}`);
console.log(`images: ${stats.converted} converted to WebP, ${stats.copied} copied`);
console.log(`originals replaced by largest variant: ${stats.fallback.length}`);
if (stats.missing.length) console.log('MISSING:\n  ' + stats.missing.join('\n  '));
