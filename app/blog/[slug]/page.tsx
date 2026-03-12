import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import AuthorBio from "@/components/AuthorBio";
import BlogCard from "@/components/BlogCard";
import { getPost, getAllPostSlugs, getRelatedPosts } from "@/lib/posts";
import GraphyLink from "@/components/GraphyLink";
import QuickAnswer from "@/components/QuickAnswer";
import NewsletterSignup from "@/components/NewsletterSignup";

// ISR — new posts served within 60 seconds, no rebuild needed
export const revalidate = 60;
export const dynamicParams = true; // serve slugs not in generateStaticParams

interface Props { params: { slug: string } }

export async function generateStaticParams() {
  // Return empty — dynamicParams=true means all slugs are served via ISR on first request
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost(params.slug);
  if (!post) return { title: "Post Not Found" };
  return {
    title:       post.title,
    description: post.description,
    keywords:    post.seoKeywords,
    authors:     [{ name: post.author }],
    openGraph: {
      title:         post.title,
      description:   post.description,
      type:          "article",
      publishedTime: post.date,
      authors:       [post.author],
      tags:          post.tags,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const [post, related] = await Promise.all([
    getPost(params.slug),
    getRelatedPosts(params.slug),
  ]);

  if (!post) notFound();

  const articleSchema = {
    "@context":  "https://schema.org",
    "@type":     "Article",
    headline:    post.title,
    description: post.description,
    author: {
      "@type":    "Person",
      name:       post.author,
      jobTitle:   post.authorRole,
      worksFor:   { "@type": "Organization", name: "Graphy.com" },
    },
    datePublished: post.date,
    publisher: {
      "@type": "Organization",
      name:    "Sandeep's Blog",
      url:     "https://sandeeps.co",
    },
    keywords: post.seoKeywords.join(", "),
  };

  // AEO: FAQ schema for Google AI Overviews + Perplexity
  const faqSchema = post.faqs?.length > 0 ? {
    "@context": "https://schema.org",
    "@type":    "FAQPage",
    mainEntity: post.faqs.map((faq) => ({
      "@type":          "Question",
      name:             faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text:    faq.answer,
      },
    })),
  } : null;

  return (
    <>
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      {faqSchema && (
        <script type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      )}

      {/* Breadcrumb */}
      <div className="bg-gray-50 border-b border-gray-100 py-3">
        <div className="max-w-3xl mx-auto px-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/" className="hover:text-brand-600">Home</Link>
          <span>/</span>
          <Link href="/blog" className="hover:text-brand-600">Blog</Link>
          <span>/</span>
          <Link href={`/categories/${post.category.toLowerCase().replace(/\s+/g, "-")}`}
            className="hover:text-brand-600">{post.category}</Link>
          <span>/</span>
          <span className="text-gray-700 truncate max-w-xs">{post.title}</span>
        </div>
      </div>

      <article className="py-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <header className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="category-badge">{post.category}</span>
              <span className="text-sm text-gray-400">{post.readingTime}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 leading-tight mb-5">
              {post.title}
            </h1>
            <p className="text-lg text-gray-600 leading-relaxed mb-6">{post.description}</p>
            <div className="flex items-center justify-between py-4 border-y border-gray-100 mb-8">
              <AuthorBio compact />
              <time className="text-sm text-gray-400" dateTime={post.date}>
                {new Date(post.date).toLocaleDateString("en-US", {
                  year: "numeric", month: "long", day: "numeric",
                })}
              </time>
            </div>

            {post.coverImage && post.coverImage !== "/images/default-cover.svg" && (
              <div className="rounded-2xl overflow-hidden mb-8 shadow-md aspect-video bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={post.coverImage} alt={post.title}
                  className="w-full h-full object-cover" />
              </div>
            )}
          </header>

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mb-8">
            {post.tags.map((tag) => (
              <span key={tag} className="tag-badge">{tag}</span>
            ))}
          </div>

          {/* Quick Answer box — targets Google Featured Snippets + AI answer engines */}
          {post.faqs && post.faqs.length > 0 && (
            <QuickAnswer
              question={post.faqs[0].question}
              answer={post.faqs[0].answer}
            />
          )}

          {/* Body */}
          <div className="prose-blog"
            dangerouslySetInnerHTML={{ __html: post.content }} />

          {/* Newsletter — mid-content capture */}
          <div className="mt-10">
            <NewsletterSignup
              variant="banner"
              source="blog-post"
              title="Get weekly creator growth tactics"
              subtitle="Join creators getting actionable tips on YouTube growth, course monetization, and the creator economy. Free, no spam."
            />
          </div>

          {/* CTA Box */}
          <div className="mt-8 bg-gradient-to-br from-brand-600 to-brand-800 rounded-2xl p-8 text-white text-center">
            <h3 className="text-xl font-black mb-2">Ready to sell your knowledge?</h3>
            <p className="text-brand-200 text-sm mb-5">
              Graphy lets you build and sell online courses in minutes — no tech skills required. Trusted by 50,000+ creators.
            </p>
            <GraphyLink utmContent="article-cta"
              className="inline-flex items-center gap-2 bg-white text-brand-700 font-semibold px-6 py-3 rounded-full hover:bg-brand-50 transition-colors">
              Start for Free on Graphy →
            </GraphyLink>
          </div>

          <div className="mt-10">
            <AuthorBio />
          </div>
        </div>
      </article>

      {related.length > 0 && (
        <section className="py-12 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-black text-gray-900 mb-6">You Might Also Like</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {related.map((p) => <BlogCard key={p.slug} post={p} />)}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
