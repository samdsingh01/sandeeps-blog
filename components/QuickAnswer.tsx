/**
 * components/QuickAnswer.tsx
 * ===========================
 * Quick Answer box — targets Google Featured Snippets and AI answer engines.
 *
 * How it works:
 *   - Displays a highlighted "Quick Answer" box at the top of blog posts
 *   - Content is a concise 2-3 sentence direct answer to the post's main question
 *   - Google extracts these for featured snippets ("position 0")
 *   - AI engines (ChatGPT, Perplexity, Gemini) cite this content in answers
 *
 * SEO impact:
 *   - Featured snippets get 35% higher CTR than regular results
 *   - AEO (Answer Engine Optimization) is the #1 future-proof SEO strategy
 *   - Structured with speakable schema for voice search
 *
 * Usage in blog post:
 *   <QuickAnswer question="How do YouTubers make money?" answer="YouTubers earn through..." />
 */

interface Props {
  question:  string;
  answer:    string;
  sources?:  Array<{ label: string; href: string }>;
  className?: string;
}

export default function QuickAnswer({ question, answer, sources, className = '' }: Props) {
  return (
    /*
     * id="quick-answer" — referenced by the Speakable JSON-LD in page.tsx
     * via cssSelector "#quick-answer". This tells Google AI Overviews, voice
     * assistants, and Perplexity exactly which block contains the primary answer.
     */
    <div
      id="quick-answer"
      className={`my-6 not-prose ${className}`}
      itemScope
      itemType="https://schema.org/Question"
    >
      <div className="border-l-4 border-brand-500 bg-brand-50 rounded-r-xl p-5">
        {/* Label */}
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 bg-brand-100 px-2.5 py-1 rounded-full">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 0C2.686 0 0 2.686 0 6s2.686 6 6 6 6-2.686 6-6S9.314 0 6 0zm.75 9H5.25V5.25h1.5V9zm0-4.5H5.25v-1.5h1.5v1.5z"/>
            </svg>
            Quick Answer
          </span>
        </div>

        {/* Question */}
        <h2
          className="text-sm font-semibold text-gray-500 mb-2 leading-snug"
          itemProp="name"
        >
          {question}
        </h2>

        {/* Answer — id="quick-answer-text" allows speakable CSS selector targeting */}
        <div itemProp="acceptedAnswer" itemScope itemType="https://schema.org/Answer">
          <p
            id="quick-answer-text"
            className="text-gray-800 leading-relaxed text-base font-medium"
            itemProp="text"
          >
            {answer}
          </p>
        </div>

        {/* Sources (optional) */}
        {sources && sources.length > 0 && (
          <div className="flex gap-3 mt-3 flex-wrap">
            {sources.map((s) => (
              <a
                key={s.href}
                href={s.href}
                className="text-xs text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                {s.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
