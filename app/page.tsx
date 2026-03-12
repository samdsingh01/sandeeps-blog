import Link from "next/link";
import BlogCard from "@/components/BlogCard";
import AuthorBio from "@/components/AuthorBio";
import { getAllPosts, getFeaturedPosts } from "@/lib/posts";
import GraphyLink from "@/components/GraphyLink";

// ISR — revalidate every 60 seconds so new posts appear within 1 minute
export const revalidate = 60;

const CATEGORIES = [
  { name: "YouTube Monetization", slug: "youtube-monetization", icon: "💰", desc: "Turn views into revenue" },
  { name: "Course Creation",       slug: "course-creation",       icon: "🎓", desc: "Sell knowledge online" },
  { name: "Creator Growth",        slug: "creator-growth",        icon: "📈", desc: "Scale your audience" },
  { name: "Content Strategy",      slug: "content-strategy",      icon: "📝", desc: "Create content that ranks" },
  { name: "AI for Creators",       slug: "ai-for-creators",       icon: "🤖", desc: "Work 10x smarter" },
];

export default async function HomePage() {
  const [featured, allPosts] = await Promise.all([
    getFeaturedPosts(),
    getAllPosts(),
  ]);
  const latest = allPosts.slice(0, 6);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 text-white py-20 lg:py-32">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)", backgroundSize: "40px 40px" }} />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-2 mb-6 text-sm font-medium">
            <span className="animate-pulse w-2 h-2 rounded-full bg-accent-yellow inline-block" />
            Built for early-stage creators & YouTube coaches
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight mb-6">
            Grow Your Creator<br />
            <span className="text-accent-yellow">Business in 2026</span>
          </h1>
          <p className="text-lg sm:text-xl text-white/80 max-w-2xl mx-auto mb-10">
            Practical guides on YouTube monetization, online course creation, and building
            a 6-figure creator business — from the team at Graphy.com.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/blog" className="btn-primary bg-white text-brand-700 hover:bg-white/90">
              Read All Articles
            </Link>
            <GraphyLink utmContent="homepage-hero-cta" className="btn-secondary border-white text-white hover:bg-white/10">
              Start on Graphy Free →
            </GraphyLink>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-14 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-black text-gray-900 text-center mb-8">Browse by Topic</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {CATEGORIES.map((cat) => (
              <Link key={cat.slug} href={`/categories/${cat.slug}`}
                className="group flex flex-col items-center text-center p-5 bg-white rounded-2xl border border-gray-100 hover:border-brand-300 hover:shadow-md transition-all">
                <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">{cat.icon}</span>
                <span className="font-semibold text-sm text-gray-800 group-hover:text-brand-600 transition-colors mb-1">{cat.name}</span>
                <span className="text-xs text-gray-400">{cat.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Posts */}
      {featured.length > 0 && (
        <section className="py-14">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-black text-gray-900">⭐ Featured Reads</h2>
              <Link href="/blog" className="text-sm font-semibold text-brand-600 hover:text-brand-700">View all →</Link>
            </div>
            <div className="space-y-6">
              {featured.map((post) => <BlogCard key={post.slug} post={post} featured />)}
            </div>
          </div>
        </section>
      )}

      {/* Latest Posts */}
      <section className="py-14 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-black text-gray-900">🔥 Latest Articles</h2>
            <Link href="/blog" className="text-sm font-semibold text-brand-600 hover:text-brand-700">View all →</Link>
          </div>
          {latest.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <p className="text-5xl mb-4">📝</p>
              <p className="text-lg font-medium">First articles coming soon — the agent is warming up!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {latest.map((post) => <BlogCard key={post.slug} post={post} />)}
            </div>
          )}
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-16 bg-brand-900 text-white">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-black mb-4">Ready to Monetize Your Knowledge?</h2>
          <p className="text-brand-200 mb-8">
            Join 50,000+ creators who use Graphy to sell courses, coaching, and digital products. No tech skills needed.
          </p>
          <GraphyLink utmContent="homepage-banner-cta" className="btn-primary bg-accent-orange hover:bg-orange-600 text-white">
            Start for Free on Graphy →
          </GraphyLink>
        </div>
      </section>

      {/* Author */}
      <section className="py-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <AuthorBio />
        </div>
      </section>
    </>
  );
}
