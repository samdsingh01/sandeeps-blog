import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import AuthorBio from "@/components/AuthorBio";
import BlogCard from "@/components/BlogCard";
import { getPost, getAllPostSlugs, getRelatedPosts } from "@/lib/posts";
import GraphyLink from "@/components/GraphyLink";
import QuickAnswer from "@/components/QuickAnswer";
import NewsletterSignup from "@/components/NewsletterSignup";

// force-dynamic: always render fresh — avoids stale ISR cache masking errors
export const dynamic       = 'force-dynamic';
export const dynamicParams = true; // serve any slug

interface Props { params: { slug: string } }

export async function generateStaticParams() {
  // Return empty — dynamicParams=true means all slugs are served via ISR on first request
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const post = await getPost(params.slug);
    if (!post) return { title: "Post Not Found" };
    const canonicalUrl = `https://sandeeps.co/blog/${params.slug}`;
    return {
      title:       post.title,
      description: post.description,
      keywords:    post.seoKeywords ?? [],
      authors:     [{ name: post.author }],
      // Canonical tells Google the authoritative URL for this post
      alternates: { canonical: canonicalUrl },
      openGraph: {
        title:         post.title,
        description:   post.description,
        type:          "article",
        url:           canonicalUrl,
        publishedTime: post.date,
        authors:       [post.author],
        tags:          post.tags ?? [],
        images:        post.coverImage
          ? [{ url: post.coverImage, width: 1200, height: 630, alt: post.title }]
          : undefined,
      },
      twitter: {
        card:        'summary_large_image',
        title:       post.title,
        description: post.description,
        images:      post.coverImage ? [post.coverImage] : undefined,
      },
    };
  } catch {
    return { title: "Post Not Found" };
  }
}

export default async function BlogPostPage({ params }: Props) {
  let post: Awaited<ReturnType<typeof getPost>>;
  let related: Awaited<ReturnType<typeof getRelatedPosts>>;

  try {
    [post, related] = await Promise.all([
      getPost(params.slug),
      getRelatedPosts(params.slug),
    ]);
  } catch (err) {
    console.error(`[BlogPostPage] Error loading post "${params.slug}":`, err);
    notFound();
  }

  if (!post) notFound();

  // Ensure all arrays are safe at render time — guards against unexpected DB nulls
  const safeFaqs       = Array.isArray(post.faqs)        ? post.faqs        : [];
  const safeTags       = Array.isArray(post.tags)        ? post.tags        : [];
  const safeSeoKw      = Array.isArray(post.seoKeywords) ? post.seoKeywords : [];
  const safeContent    = post.content ?? '';
  const safeCategory   = post.category ?? 'General';

  const canonicalUrl  = `https://sandeeps.co/blog/${post.slug}`;
  const authorId      = 'https://sandeeps.co/#author';
  const publisherId   = 'https://sandeeps.co/#organization';

  // ── Article schema — comprehensive for Google AI Overviews + Perplexity ──
  // Key fields AI engines look for:
  //   dateModified → signals freshness (stale content gets de-prioritised)
  //   image        → enables rich results and visual AEO citations
  //   wordCount    → signals depth (AI engines favour comprehensive coverage)
  //   @id          → links this article into the site's entity graph
  //   about        → named topic entity (helps AI understand what this covers)
  //   speakable    → marks extractable answer blocks for voice + AI snippets
  const articleSchema = {
    "@context":        "https://schema.org",
    "@type":           "Article",
    "@id":             `${canonicalUrl}#article`,
    headline:          post.title,
    description:       post.description,
    url:               canonicalUrl,
    mainEntityOfPage:  { "@type": "WebPage", "@id": canonicalUrl },
    inLanguage:        "en-US",
    author: {
      "@type":    "Person",
      "@id":      authorId,
      name:       post.author,
      jobTitle:   post.authorRole,
      url:        "https://sandeeps.co/about",
      worksFor: {
        "@type": "Organization",
        "@id":   "https://graphy.com/#organization",
        name:    "Graphy.com",
        url:     "https://graphy.com",
      },
    },
    publisher: {
      "@type": "Organization",
      "@id":   publisherId,
      name:    "Sandeep's Blog",
      url:     "https://sandeeps.co",
      logo: {
        "@type": "ImageObject",
        url:     "https://sandeeps.co/images/logo.png",
      },
    },
    datePublished:  post.date,
    dateModified:   post.updatedAt ?? post.date,
    keywords:       safeSeoKw.join(", "),
    articleSection: safeCategory,
    // image — required for Google rich results; AI engines use it for visual citations
    ...(post.coverImage && post.coverImage !== "/images/default-cover.svg" ? {
      image: {
        "@type":  "ImageObject",
        url:      post.coverImage.startsWith("http")
          ? post.coverImage
          : `https://sandeeps.co${post.coverImage}`,
        width:    1200,
        height:   630,
        caption:  post.title,
      },
    } : {}),
    // speakable — tells Google AI Overviews which element is the quotable answer
    ...(safeFaqs.length > 0 ? {
      speakable: {
        "@type":       "SpeakableSpecification",
        cssSelector:   ["#quick-answer", "#quick-answer-text"],
      },
    } : {}),
    // about — named entity: what this article is actually about
    about: {
      "@type": "Thing",
      name:    safeCategory,
    },
  };

  // AEO: FAQ schema for Google AI Overviews + Perplexity
  const faqSchema = safeFaqs.length > 0 ? {
    "@context": "https://schema.org",
    "@type":    "FAQPage",
    mainEntity: safeFaqs.map((faq) => ({
      "@type":          "Question",
      name:             faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text:    faq.answer,
      },
    })),
  } : null;

  // AEO: BreadcrumbList schema — helps AI engines understand site hierarchy
  // and enables Google sitelinks breadcrumbs in SERPs
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type":    "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home",     item: "https://sandeeps.co" },
      { "@type": "ListItem", position: 2, name: "Blog",     item: "https://sandeeps.co/blog" },
      { "@type": "ListItem", position: 3, name: safeCategory,
        item: `https://sandeeps.co/categories/${safeCategory.toLowerCase().replace(/\s+/g, "-")}` },
      { "@type": "ListItem", position: 4, name: post.title, item: canonicalUrl },
    ],
  };

  // AEO: HowTo schema — detect step-by-step posts from content HTML
  // Looks for ordered-list items inside the post body. When found, AI engines
  // (especially Google AI Overviews) display step-by-step rich results.
  const howToSteps: Array<{ name: string; text: string }> = [];
  const stepMatches = safeContent.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  let stepIndex = 0;
  for (const match of stepMatches) {
    if (stepIndex >= 10) break;
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 20 && text.length < 300) {
      howToSteps.push({ name: `Step ${stepIndex + 1}`, text });
      stepIndex++;
    }
  }
  // Only emit HowTo schema if title signals instructional intent AND we have steps
  const isHowToPost =
    howToSteps.length >= 3 &&
    /^(how to|guide to|step[s]? to|ways to|\d+ (ways|steps|tips|methods))/i.test(post.title);
  const howToSchema = isHowToPost ? {
    "@context":   "https://schema.org",
    "@type":      "HowTo",
    name:         post.title,
    description:  post.description,
    image:        post.coverImage && post.coverImage !== "/images/default-cover.svg"
      ? (post.coverImage.startsWith("http") ? post.coverImage : `https://sandeeps.co${post.coverImage}`)
      : undefined,
    author: { "@type": "Person", "@id": authorId },
    step: howToSteps.slice(0, 10).map((s, i) => ({
      "@type":    "HowToStep",
      position:   i + 1,
      name:       s.name,
      text:       s.text,
    })),
  } : null;

  return (
    <>
      {/* Article — core identity + speakable + author entity */}
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      {/* FAQPage — prime AEO target: Google AI Overviews, Perplexity, ChatGPT */}
      {faqSchema && (
        <script type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      )}
      {/* BreadcrumbList — site hierarchy for AI + sitelinks breadcrumbs */}
      <script type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      {/* HowTo — step-by-step rich results (only on instructional posts) */}
      {howToSchema && (
        <script type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }} />
      )}

      {/* Breadcrumb */}
      <div className="bg-gray-50 border-b border-gray-100 py-3">
        <div className="max-w-3xl mx-auto px-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/" className="hover:text-brand-600">Home</Link>
          <span>/</span>
          <Link href="/blog" className="hover:text-brand-600">Blog</Link>
          <span>/</span>
          <Link href={`/categories/${safeCategory.toLowerCase().replace(/\s+/g, "-")}`}
            className="hover:text-brand-600">{safeCategory}</Link>
          <span>/</span>
          <span className="text-gray-700 truncate max-w-xs">{post.title}</span>
        </div>
      </div>

      <article className="py-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <header className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="category-badge">{safeCategory}</span>
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
            {safeTags.map((tag) => (
              <span key={tag} className="tag-badge">{tag}</span>
            ))}
          </div>

          {/* Quick Answer box — targets Google Featured Snippets + AI answer engines */}
          {safeFaqs.length > 0 && (
            <QuickAnswer
              question={safeFaqs[0].question}
              answer={safeFaqs[0].answer}
            />
          )}

          {/* Body */}
          <div className="prose-blog"
            dangerouslySetInnerHTML={{ __html: safeContent }} />

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
