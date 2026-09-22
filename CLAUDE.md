# Stafford Jazz Society website

Static rebuild of the club's former WordPress site (staffordjazz.org), built with Astro and
deployed to GitHub Pages. The brief is a faithful reproduction of the old Twenty Sixteen look:
**no unapproved UX changes** — visual changes need the client's sign-off first.

## Commands

```sh
npm run dev       # dev server (search does not work here: no Pagefind index)
npm run build     # astro build + pagefind index into dist/
npm run preview   # serve dist/ (Astro 7 detaches it; stop with `npx astro preview stop`)
npm run export    # regenerate content from the WordPress dump — see "Migration" below
```

Pushing to `main` deploys via `.github/workflows/deploy.yml` (GitHub Pages, custom domain in
`public/CNAME`). No branches or PRs are used in this repo.

## Structure

```
src/
  content.config.ts       collections: posts (src/content/posts), pages (src/content/pages)
  content/posts/          YYYY-MM-DD-slug.md  -> /YYYY/MM/slug/
  content/pages/          slug.md -> /slug/ ; index.md is the front page (General Info)
  data/site.json          title, tagline, author, logo, main menu (5 items)
  data/legacy-urls.json   WordPress post ID -> new URL (front page JS redirects ?p=ID / ?page_id=ID)
  lib/posts.ts            getPosts(), postUrl(), month keys, WordPress-style date formatting
  layouts/Base.astro      header, primary menu, sidebar, content-bottom rule, footer, legacy redirect
  components/Sidebar.astro   search box, Recent Posts (5), Archives month dropdown
  components/Entry.astro     one post (list or single) — no author/date column by design
  components/Pagination.astro
  pages/[...path].astro   the single route: pages, posts, month/year/author archives (+ /page/N/)
  pages/search.astro      /search/?s=term, client-side Pagefind, newest-first like WordPress
  pages/404.astro
public/
  theme/twentysixteen/    stock Twenty Sixteen CSS, fonts, Genericons (GPL — see theme/NOTICE.md)
  theme/wp/               WordPress core block-library + classic-theme CSS
  theme/site.css          our only CSS: WP global-style vars, footer slash removal, full-width posts
  theme/icon-*.png, favicon.ico   generated from the logo by the export script
  wp-content/uploads/     migrated images, original paths kept; large PNG/JPEG re-encoded as .webp
scripts/
  db.sh                   loads the SQL dump into a throwaway MariaDB container (sj-db, port 3307)
  export.mjs              WordPress DB + wp-source/ files -> src/content, src/data, public/wp-content
```

## Conventions

- Post/page bodies are the original WordPress HTML wrapped in `<div class="wp-content">` with no
  blank lines, so the Markdown renderer passes it through untouched. New posts can be plain Markdown.
- Front matter: `title`, `date` (ISO, no timezone), optional `excerpt`, `featuredImage {src,width,height,alt}`,
  `wpId`. Pages may set `latestPosts: N` to append the newest N posts (front page does).
- Markup mirrors Twenty Sixteen's templates and class names so the stock theme CSS applies.
  When in doubt about layout, read the theme in `public/theme/twentysixteen/style.css` — don't
  restyle from scratch.
- The site has one author, so posts intentionally omit the byline/date column
  (`Entry.astro` + override in `site.css`). Dates remain as screen-reader text for Pagefind sorting.
- Search relies on `data-pagefind-body` / `data-pagefind-meta` attributes in `Entry.astro` and the
  page template; keep them if you touch that markup.
- URLs: `trailingSlash: 'always'`, directory output. Image URLs under `/wp-content/uploads/`
  are the same as on the old site (except `.webp` conversions).

## Migration (one-off; normally not needed)

`npm run export` requires Docker, the SQL dump in the repo root and the old site's files in
`wp-source/` — both are git-ignored (the dump holds user emails/password hashes; never commit).
It **overwrites** `src/content/`, `src/data/`, `public/wp-content/` and the icons, so do not run
it once content has been edited by hand. WordPress facts it depends on: table prefix `tQfwtqLw`,
theme `twentysixteen`, front page ID 573, only shortcode `[gallery]`, some posts hotlinked images
from Tumblr (rescued copies live in `wp-source/tumblr/`).

## Known differences from the old site

No comment forms (none were ever approved), no "Proudly powered by WordPress" credit, WordPress
default "Sample Page" dropped, `?p=ID` links redirect instead of resolving in place.
