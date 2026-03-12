/**
 * supabase/seed.ts
 * ================
 * One-time script: migrates your existing markdown posts into Supabase.
 * Run once after setting up the DB: npm run seed
 *
 * Usage:
 *   1. Add your Supabase keys to .env.local
 *   2. Run: npm run seed
 */

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import remarkGfm from 'remark-gfm';
import readingTime from 'reading-time';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function renderMarkdown(content: string): Promise<string> {
  const processed = await remark().use(remarkGfm).use(remarkHtml).process(content);
  return processed.toString();
}

async function seedPosts() {
  const postsDir = path.join(process.cwd(), 'content', 'posts');

  if (!fs.existsSync(postsDir)) {
    console.log('No content/posts directory found — nothing to seed.');
    return;
  }

  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md'));
  console.log(`Found ${files.length} markdown files to seed`);

  let inserted = 0;
  let skipped  = 0;

  for (const file of files) {
    const slug     = file.replace(/\.md$/, '');
    const fullPath = path.join(postsDir, file);
    const raw      = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(raw);

    const contentHtml = await renderMarkdown(content);
    const rt          = readingTime(content);

    const row = {
      slug,
      title:        data.title        ?? slug,
      description:  data.description  ?? '',
      content,
      content_html: contentHtml,
      category:     data.category     ?? 'General',
      tags:         data.tags         ?? [],
      author:       data.author       ?? 'Sandeep Singh',
      author_role:  data.authorRole   ?? 'Co-founder, Graphy.com',
      cover_image:  data.coverImage   ?? '/images/default-cover.svg',
      seo_keywords: data.seoKeywords  ?? [],
      reading_time: rt.text,
      featured:     data.featured     ?? false,
      status:       'published',
      published_at: data.date         ? new Date(data.date).toISOString() : new Date().toISOString(),
    };

    const { error } = await db
      .from('posts')
      .upsert(row, { onConflict: 'slug', ignoreDuplicates: true });

    if (error) {
      console.error(`  ❌ ${slug}: ${error.message}`);
    } else {
      console.log(`  ✅ ${slug}`);
      inserted++;
    }
  }

  console.log(`\nSeeding complete: ${inserted} inserted, ${skipped} skipped`);
}

seedPosts().catch(console.error);
