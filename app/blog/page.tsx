import type { Metadata } from "next";
import BlogCard from "@/components/BlogCard";
import { getAllPosts, getAllCategories } from "@/lib/posts";
import Link from "next/link";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "All Articles — Sandeep's Blog",
  description: "Browse all guides on YouTube monetization, online course creation, creator growth, and AI tools for content creators.",
};

export default async function BlogPage() {
  const [posts, categories] = await Promise.all([
    getAllPosts(),
    getAllCategories(),
  ]);

  return (
    <div className="py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-black text-gray-900 mb-4">All Articles</h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Practical, research-backed guides to help you grow on YouTube, create online courses,
            and build a sustainable creator business.
          </p>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-3 justify-center mb-10">
          <Link href="/blog" className="category-badge bg-brand-600 text-white">All</Link>
          {categories.map((cat) => (
            <Link key={cat} href={`/categories/${cat.toLowerCase().replace(/\s+/g, "-")}`}
              className="category-badge hover:bg-brand-200 transition-colors">
              {cat}
            </Link>
          ))}
        </div>

        {/* Posts Grid */}
        {posts.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-4">📝</p>
            <p className="text-lg font-medium">No articles yet — the AI agent will add them soon!</p>
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
