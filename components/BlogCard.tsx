import Link from 'next/link';
import type { PostMeta } from '@/lib/posts';

interface BlogCardProps {
  post: PostMeta;
  featured?: boolean;
}

/** Fallback gradient when no real image is available */
const categoryGradient: Record<string, string> = {
  'YouTube Monetization': 'from-orange-400 to-red-600',
  'Course Creation':      'from-brand-400 to-brand-700',
  'Creator Growth':       'from-blue-500 to-brand-700',
  'Content Strategy':     'from-teal-400 to-brand-600',
  'AI for Creators':      'from-violet-500 to-brand-800',
};
const categoryEmoji: Record<string, string> = {
  'YouTube Monetization': '💰',
  'Course Creation':      '🎓',
  'Creator Growth':       '📈',
  'Content Strategy':     '📝',
  'AI for Creators':      '🤖',
};

function CoverImage({
  src,
  alt,
  category,
  className = '',
}: {
  src?: string;
  alt: string;
  category: string;
  className?: string;
}) {
  const gradient = categoryGradient[category] ?? 'from-brand-500 to-brand-800';
  const emoji    = categoryEmoji[category] ?? '🚀';
  const hasImage = src && src !== '/images/default-cover.svg';

  if (hasImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover ${className}`}
        loading="lazy"
      />
    );
  }

  // Fallback gradient + emoji when agent hasn't generated an image yet
  return (
    <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center ${className}`}>
      <span className="text-5xl">{emoji}</span>
    </div>
  );
}

export default function BlogCard({ post, featured = false }: BlogCardProps) {
  const alt = `${post.title} — Sandeep's Blog`;

  if (featured) {
    return (
      <article className="group relative flex flex-col lg:flex-row gap-0 bg-white border border-brand-100 rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300">
        {/* Cover image */}
        <div className="lg:w-2/5 h-56 lg:h-auto relative overflow-hidden flex-shrink-0">
          <CoverImage src={post.coverImage} alt={alt} category={post.category} className="transition-transform duration-500 group-hover:scale-105" />
          {/* Category badge overlay */}
          <div className="absolute top-4 left-4">
            <span className="category-badge bg-white/90 backdrop-blur text-brand-700 shadow-sm">
              {post.category}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col justify-center p-6 lg:p-8 lg:w-3/5">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-gray-400">{post.readingTime}</span>
          </div>
          <h2 className="text-xl lg:text-2xl font-bold text-gray-900 mb-3 group-hover:text-brand-600 transition-colors line-clamp-3">
            <Link href={`/blog/${post.slug}`}>{post.title}</Link>
          </h2>
          <p className="text-gray-600 text-sm leading-relaxed mb-5 line-clamp-3">{post.description}</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                S
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-800">{post.author}</p>
                <p className="text-xs text-gray-400">{post.authorRole}</p>
              </div>
            </div>
            <Link
              href={`/blog/${post.slug}`}
              className="text-brand-600 hover:text-brand-700 text-sm font-semibold"
            >
              Read more →
            </Link>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group flex flex-col bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      {/* Cover image */}
      <div className="h-44 relative overflow-hidden flex-shrink-0">
        <CoverImage src={post.coverImage} alt={alt} category={post.category} className="transition-transform duration-500 group-hover:scale-105" />
        {/* Category badge overlay */}
        <div className="absolute top-3 left-3">
          <span className="category-badge bg-white/90 backdrop-blur text-brand-700 text-xs shadow-sm">
            {post.category}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-400">{post.readingTime}</span>
        </div>
        <h2 className="font-bold text-gray-900 text-base mb-2 group-hover:text-brand-600 transition-colors line-clamp-2">
          <Link href={`/blog/${post.slug}`}>{post.title}</Link>
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-4 line-clamp-3 flex-1">
          {post.description}
        </p>
        <div className="flex flex-wrap gap-1 mb-3">
          {post.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="tag-badge">{tag}</span>
          ))}
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <span className="text-xs text-gray-400">
            {new Date(post.date).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </span>
          <Link href={`/blog/${post.slug}`} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            Read →
          </Link>
        </div>
      </div>
    </article>
  );
}
