import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const image = z.object({
  src: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  alt: z.string().default(''),
});

// Posts are named YYYY-MM-DD-slug.md; the URL is /YYYY/MM/slug/ (date taken from front matter).
const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().default(''),
    date: z.coerce.date(),
    excerpt: z.string().optional(),
    featuredImage: image.optional(),
    wpId: z.number().optional(),
  }),
});

// Pages are named slug.md and served at /slug/; index.md is the front page.
const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date().optional(),
    featuredImage: image.optional(),
    latestPosts: z.number().optional(),
    wpId: z.number().optional(),
  }),
});

export const collections = { posts, pages };
