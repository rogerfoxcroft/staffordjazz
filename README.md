# Stafford Jazz Society website

Static rebuild of the former WordPress site at <https://staffordjazz.org>, built with
[Astro](https://astro.build) and deployed to GitHub Pages. It reproduces the old site's
Twenty Sixteen look using the theme's own stylesheets (see `public/theme/NOTICE.md`).

## Working on the site

```sh
npm install
npm run dev       # live preview at http://localhost:4321 (search is unavailable in dev)
npm run build     # production build into dist/, including the Pagefind search index
npm run preview   # serve dist/
```

Pushing to `main` builds and deploys via `.github/workflows/deploy.yml`.

## Adding content

**A post** — create `src/content/posts/YYYY-MM-DD-some-slug.md`:

```md
---
title: "June 2026 Concerts"
date: "2026-07-02T10:00:00"
# optional:
# excerpt: "Shown on the front page; defaults to the first 55 words."
# featuredImage: { src: "/wp-content/uploads/2026/07/band.webp", width: 1200, height: 900 }
---

Ordinary **Markdown** goes here.

![The band](/wp-content/uploads/2026/07/band.webp)
```

It appears at `/2026/07/some-slug/`, and automatically in Recent Posts, the front page's latest
posts, the Archives dropdown, the month/year archives and search. Put images in
`public/wp-content/uploads/YYYY/MM/` (resize photos to ~2000px wide and save as WebP or JPEG first).

**A page** — add `src/content/pages/slug.md` (served at `/slug/`). `index.md` is the front page.
The Gig List is `src/content/pages/gigs.md`.

**The menu** and site title live in `src/data/site.json`.

Migrated posts contain the original WordPress HTML wrapped in a `<div class="wp-content">`; they
can be edited in place, but keep the block free of blank lines so Markdown leaves it alone.

## URLs

WordPress used plain permalinks (`/?p=123`). Those still work: the front page redirects them using
`src/data/legacy-urls.json`. Image URLs under `/wp-content/uploads/` are unchanged, except that
large PNG/JPEGs were re-encoded as `.webp`.

## Re-running the migration

Only needed if the export logic changes. Requires Docker, the SQL dump in the repo root and the old
site's files in `wp-source/` (both git-ignored — the dump contains personal data, never commit it):

```sh
npm run export    # scripts/db.sh + scripts/export.mjs
```

This **overwrites** `src/content/`, `src/data/` and `public/wp-content/`, so don't run it once
posts have been added or edited by hand.
