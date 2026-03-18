import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BlogCard from "@/components/BlogCard";
import { getPostsByCategory } from "@/lib/posts";

export const dynamic       = 'force-dynamic';
export const dynamicParams = true;

const CATEGORY_META: Record<string, { title: string; description: string; icon: string }> = {
  "youtube-monetization": {
    title:       "YouTube Monetization",
    description: "Learn how to turn your YouTube channel into a revenue-generating machine. AdSense, memberships, Super Chats, sponsorships, and more.",
    icon: "💰",
  },
  "course-creation": {
    title:       "Course Creation",
    description: "Step-by-step guides on creating, launching, and selling profitable online courses. From idea to $10k/month.",
    icon: "🎓",
  },
  "creator-growth": {
    title:       "Creator Growth",
    description: "Scale your audience, build an email list, get brand deals, and grow your creator business sustainably.",
    icon: "📈",
  },
  "content-strategy": {
    title:       "Content Strategy & SEO",
    description: "Master YouTube SEO, video scripting, thumbnail strategy, and content planning to grow faster.",
    icon: "📝",
  },
  "ai-for-creators": {
    // Legacy slug redirect — keeps old URLs working
    title:       "AI for Creator Economy",
    description: "Exactly how to use AI to grow your channel, build courses, and run your creator business. Step-by-step workflows with ChatGPT, Gemini, ElevenLabs, and more — not just \"AI can help\" theory.",
    icon: "🤖",
  },
  "ai-for-creator-economy": {
    title:       "AI for Creator Economy",
    description: "Exactly how to use AI to grow your channel, build courses, and run your creator business. Step-by-step workflows with ChatGPT, Gemini, ElevenLabs, and more — not just \"AI can help\" theory.",
    icon: "🤖",
  },
};

interface Props { params: { category: string } }

export async function generateStaticParams() {
  // Return empty — dynamicParams=true means all categories are served via ISR on first request
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const meta = CATEGORY_META[params.category];
  if (!meta) return { title: "Category Not Found" };
  // Use canonical to consolidate the legacy "ai-for-creators" slug with the new one
  const canonicalSlug = params.category === 'ai-for-creators' ? 'ai-for-creator-economy' : params.category;
  return {
    title:       `${meta.title} | Sandeep's Blog`,
    description: meta.description,
    alternates:  { canonical: `https://sandeeps.co/categories/${canonicalSlug}` },
  };
}

export default async function CategoryPage({ params }: Props) {
  const meta = CATEGORY_META[params.category];
  if (!meta) notFound();

  let posts: Awaited<ReturnType<typeof getPostsByCategory>> = [];
  try {
    posts = await getPostsByCategory(meta.title);
  } catch (err) {
    console.error(`[CategoryPage] Error loading category "${params.category}":`, err);
    posts = [];
  }

  return (
    <div className="py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="text-6xl mb-4">{meta.icon}</div>
          <h1 className="text-4xl font-black text-gray-900 mb-4">{meta.title}</h1>
          <p className="text-gray-500 max-w-xl mx-auto">{meta.description}</p>
          <p className="text-sm text-brand-600 font-semibold mt-2">{posts.length} articles</p>
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-4">🚀</p>
            <p className="text-lg font-medium">New articles coming soon!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => <BlogCard key={post.slug} post={post} />)}
          </div>
        )}
      </div>
    </div>
  );
}
