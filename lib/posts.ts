import { unstable_noStore as noStore } from 'next/cache';
import { getPublicClient, DbPost, DbFAQItem } from './supabase';

export type FAQItem = DbFAQItem;

export interface PostMeta {
  slug:        string;
  title:       string;
  description: string;
  date:        string;
  updatedAt:   string;   // ISO — used for Article dateModified in schema
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
    slug:        row.slug        ?? '',
    title:       row.title       ?? 'Untitled',
    description: row.description ?? '',
    date:        row.published_at ?? new Date().toISOString(),
    updatedAt:   row.updated_at  ?? row.published_at ?? new Date().toISOString(),
    category:    row.category    ?? 'General',
    // Guard: DB may return null even though schema says NOT NULL (migration timing)
    tags:        Array.isArray(row.tags)        ? row.tags        : [],
    author:      row.author      ?? 'Sandeep Singh',
    authorRole:  row.author_role ?? 'Co-founder, Graphy.com',
    readingTime: row.reading_time ?? '5 min read',
    featured:    row.featured    ?? false,
    coverImage:  row.cover_image ?? '/images/default-cover.svg',
    seoKeywords: Array.isArray(row.seo_keywords) ? row.seo_keywords : [],
  };
}

function parseFaqs(raw: unknown): FAQItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as FAQItem[];
  // Handle rare case where faq is stored/returned as a JSON string
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as FAQItem[] : [];
    } catch { return []; }
  }
  return [];
}

function toPost(row: DbPost): Post {
  return {
    ...toPostMeta(row),
    // Guard: content_html may be empty/null for posts created before migration
    content: row.content_html || row.content || '',
    faqs:    parseFaqs(row.faq),
  };
}

export async function getAllPosts(): Promise<PostMeta[]> {
  noStore(); // bypass Next.js data cache — always fetch live from Supabase
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
  noStore();
  const { data, error } = await getPublicClient()
    .from('posts').select('*').eq('status', 'published').eq('featured', true)
    .order('published_at', { ascending: false }).limit(3);
  if (error) { console.error('getFeaturedPosts:', error); return []; }
  return (data as DbPost[]).map(toPostMeta);
}

export async function getPostsByCategory(category: string): Promise<PostMeta[]> {
  noStore();
  // Use partial ilike match for the AI category to capture both:
  //   "AI for Creators" (old posts) and "AI for Creator Economy" (new posts)
  const filter = category.startsWith('AI for Creator')
    ? `AI for Creator%`
    : category;
  const { data, error } = await getPublicClient()
    .from('posts').select('*').eq('status', 'published').ilike('category', filter)
    .order('published_at', { ascending: false });
  if (error) { console.error('getPostsByCategory:', error); return []; }
  return (data as DbPost[]).map(toPostMeta);
}

export async function getAllCategories(): Promise<string[]> {
  noStore();
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
