import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export const POSTS_PER_PAGE = 10;

const pad = (n: number) => String(n).padStart(2, '0');

export const postSlug = (post: Post) => post.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');

export const postUrl = (post: Post) => {
  const d = post.data.date;
  return `/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${postSlug(post)}/`;
};

export const monthKey = (post: Post) => {
  const d = post.data.date;
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}`;
};

// WordPress date_format "F j, Y"
export const formatDate = (d: Date) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export const formatMonth = (key: string) => {
  const [y, m] = key.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });
};

/** All posts, newest first. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts');
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** Month keys ("2026/06") that have posts, newest first. */
export const getMonths = (posts: Post[]) => [...new Set(posts.map(monthKey))];

export function excerptOf(post: Post): string {
  if (post.data.excerpt) return post.data.excerpt;
  const words = (post.body ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 55 ? words.slice(0, 55).join(' ') + '…' : words.join(' ');
}
