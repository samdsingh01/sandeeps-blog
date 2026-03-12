"use client";
import Link from "next/link";
import { useState } from "react";
import GraphyLink from "@/components/GraphyLink";

const NAV = [
  { label: "Blog", href: "/blog" },
  { label: "YouTube Monetization", href: "/categories/youtube-monetization" },
  { label: "Course Creation", href: "/categories/course-creation" },
  { label: "Creator Growth", href: "/categories/creator-growth" },
  { label: "🧮 YT Earnings Calculator", href: "/tools/youtube-earnings-calculator" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-black text-sm">
              CL
            </div>
            <span className="font-black text-lg text-gray-900 group-hover:text-brand-600 transition-colors">
              Creator<span className="text-brand-600">Launchpad</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-6">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-gray-600 hover:text-brand-600 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* CTA — UTM tracked */}
          <div className="hidden lg:flex items-center gap-3">
            <GraphyLink
              utmContent="header-nav-cta"
              className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              Try Graphy Free →
            </GraphyLink>
          </div>

          {/* Mobile menu button */}
          <button
            className="lg:hidden p-2 rounded-md text-gray-600"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {open && (
          <div className="lg:hidden py-4 border-t border-gray-100 space-y-2">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block px-2 py-2 text-sm font-medium text-gray-700 hover:text-brand-600"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <GraphyLink
              utmContent="header-mobile-cta"
              className="block mt-3 btn-primary text-center text-sm"
              onClick={() => setOpen(false)}
            >
              Try Graphy Free →
            </GraphyLink>
          </div>
        )}
      </div>
    </header>
  );
}
