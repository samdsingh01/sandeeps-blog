import Link from "next/link";
import GraphyLink from "@/components/GraphyLink";

const CATEGORIES = [
  { label: "YouTube Monetization", href: "/categories/youtube-monetization" },
  { label: "Course Creation", href: "/categories/course-creation" },
  { label: "Creator Growth", href: "/categories/creator-growth" },
  { label: "Content Strategy & SEO", href: "/categories/content-strategy" },
  { label: "AI for Creators", href: "/categories/ai-for-creators" },
];

export default function Footer() {
  return (
    <footer className="bg-gray-950 text-gray-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-black text-sm">
                CL
              </div>
              <span className="font-black text-lg text-white">
                Creator<span className="text-brand-400">Launchpad</span>
              </span>
            </Link>
            <p className="text-sm leading-relaxed max-w-xs">
              Actionable guides for early-stage creators to grow their YouTube channel,
              monetize their audience, and build a sustainable business — powered by{" "}
              <GraphyLink utmContent="footer-brand-link" className="text-brand-400 hover:text-brand-300 font-medium">
                Graphy.com
              </GraphyLink>
              .
            </p>
            <p className="mt-4 text-xs text-gray-500">
              Written by{" "}
              <span className="text-gray-300 font-semibold">Sandeep Singh</span>
              {" — Co-founder, Graphy.com"}
            </p>
          </div>

          {/* Topics */}
          <div>
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Topics</h3>
            <ul className="space-y-2">
              {CATEGORIES.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className="text-sm hover:text-white transition-colors">
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/blog" className="hover:text-white transition-colors">All Articles</Link></li>
              <li><Link href="/about" className="hover:text-white transition-colors">About the Author</Link></li>
              <li>
                <GraphyLink utmContent="footer-nav-link" className="hover:text-white transition-colors">
                  Start on Graphy Free
                </GraphyLink>
              </li>
              <li>
                <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                  YouTube Creator Academy
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-gray-600">
          <p>© {new Date().getFullYear()} Sandeep's Blog. A property of Graphy.com. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-gray-400 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-400 transition-colors">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
