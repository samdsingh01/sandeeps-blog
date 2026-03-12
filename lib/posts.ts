import { getPublicClient, DbPost, DbFAQItem } from './supabase';

export type FAQItem = DbFAQItem;

export interface PostMeta {
  slug:        string;
  title:       string;
  description: string;
  date:        string;
  category:    string;
  tags:        string[];
  author:      string;
  authorRole:  string;
  readingTime: string;
  featured:    boolean;
  coverImage:  string;
  seoKeywords: string[];
}

export interface Post extends PostMeta {
  content: string;
  faqs:    FAQItem[];  // AEO: FAQ structured data
}

function toPostMeta(row: DbPost): PostMeta {
  return {
    slug:        row.slug,
    title:       row.title,
    description: row.description,
    date:        row.published_at,
    category:    row.category,
    tags:        row.tags ?? [],
    author:      row.author,
    authorRole:  row.author_role,
    readingTime: row.reading_time,
    featured:    row.featured,
    coverImage:  row.cover_image,
    seoKeywords: row.seo_keywords ?? [],
  };
}

function toPost(row: DbPost): Post {
  return {
    ...toPostMeta(row),
    content: row.content_html,
    faqs:    row.faq ?? [],
  };
}

export async function getAllPosts(): Promise<PostMeta[]> {
  const { data, error } = await getPublicClient()
    .from('posts').select('*').eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) { console.error('getAllPosts:', error); return []; }
  return (data as DbPost[]).map(toPostMeta);
}

export async function getAllPostSlugs(): Promise<string[]> {
  const { data, error } = await getPublicClient()
    .from('posts').select('slug').eq('status', 'published');
  if (error) { console.error('getAllPostSlugs:', error); return []; }
  return (data ?? []).map((r: { slug: string }) => r.slug);
}

export async function getPost(slug: string): Promise<Post | null> {
  const { data, error } = await getPublicClient()
    .from('posts').select('*').eq('slug', slug).eq('status', 'published').single();
  if (error || !data) return null;
  return toPost(data as DbPost);
}

export async function getPostMeta(slug: string): Promise<PostMeta | null> {
  const { data, error } = await getPublicClient()
    .from('posts').select('*').eq('slug', slug).eq('status', 'published').single();
  if (error || !data) return null;
  return toPostMeta(data as DbPost);
}

export async function getFeaturedPosts(): Promise<PostMeta[]> {
  const { data, error } = await getPublicClient()
    .from('posts').select('*').eq('status', 'published').eq('featured', true)
    .order('published_at', { ascending: false }).limit(3);
  if (error) { console.error('getFeaturedPosts:', error); return []; }
  return (data as DbPost[]).map(toPostMeta);
}

export async function getPostsByCategory(category: string): Promise<PostMeta[]> {
  const { data, error } = await getPublicClient()
    .from('posts').select('*').eq('status', 'published').ilike('category', category)
    .order('published_at', { ascending: false });
  if (error) { console.error('getPostsByCategory:', error); return []; }
  return (data as DbPost[]).map(toPostMeta);
}

export async function getAllCategories(): Promise<string[]> {
  const { data, error } = await getPublicClient()
    .from('posts').select('category').eq('status', 'published');
  if (error) { console.error('getAllCategories:', error); return []; }
  return Array.from(new Set((data ?? []).map((r: { category: string }) => r.category)));
}

export async function getRelatedPosts(slug: string, limit = 3): Promise<PostMeta[]> {
  const post = await getPostMeta(slug);
  if (!post) return [];
  const { data, error } = await getPublicClient()
    .from('posts').select('*').eq('status', 'published').neq('slug', slug)
    .eq('category', post.category).order('published_at', { ascending: false }).limit(limit);
  if (error) { console.error('getRelatedPosts:', error); return []; }
  return (data as DbPost[]).map(toPostMeta);
}
