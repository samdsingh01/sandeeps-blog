"use client";
import GraphyLink from "@/components/GraphyLink";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

export default function AboutPage() {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {/* Hero section */}
        <div className="text-center mb-12">
          <div className="w-32 h-32 rounded-full overflow-hidden mx-auto mb-6 ring-4 ring-brand-100 shadow-lg">
            {!imgError ? (
              <Image
                src="/images/author/sandeep.jpg"
                alt="Sandeep Singh — Co-founder, Graphy.com"
                width={128}
                height={128}
                className="w-full h-full object-cover object-top"
                onError={() => setImgError(true)}
                priority
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/images/author/sandeep-placeholder.svg"
                alt="Sandeep Singh"
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <h1 className="text-4xl font-black text-gray-900 mb-3">Sandeep Singh</h1>
          <p className="text-brand-600 font-semibold text-lg">Co-founder, Graphy.com</p>

          {/* Social links */}
          <div className="flex justify-center gap-4 mt-4">
            <a
              href="https://www.linkedin.com/in/samdsingh/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-full text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              💼 LinkedIn
            </a>
            <GraphyLink
              utmContent="about-page-cta"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-full text-sm font-semibold hover:bg-brand-700 transition-colors"
            >
              🚀 Graphy.com
            </GraphyLink>
          </div>
        </div>

        <div className="prose prose-lg max-w-none text-gray-700">
          <p>
            I'm Sandeep Singh, co-founder of <GraphyLink utmContent="about-inline-link" className="text-brand-600">Graphy.com</GraphyLink> —
            a platform that has helped over 50,000 creators build, launch, and monetize their online courses
            and coaching programs.
          </p>
          <p>
            Before Graphy, I spent years in the creator economy — watching talented educators,
            coaches, and YouTubers struggle to turn their expertise into income, not because their
            content wasn't good, but because nobody gave them a clear, actionable roadmap.
          </p>
          <p>
            That's why I started Sandeep's Blog. This blog is my way of giving back — sharing
            everything I know about YouTube monetization, course creation, creator growth, and using
            AI to build faster.
          </p>
          <h2>Why Sandeep's Blog?</h2>
          <p>
            Most "creator advice" online is either too vague ("just post consistently!") or
            written by people who've never actually built a creator business. I write from the
            trenches — from data, from talking to thousands of creators on Graphy, and from
            watching what actually works in 2026.
          </p>
          <h2>What You'll Find Here</h2>
          <ul>
            <li><strong>YouTube Monetization</strong> — How to qualify for YPP faster, maximize AdSense, add revenue streams</li>
            <li><strong>Online Course Creation</strong> — From idea validation to launch to scaling past $10k/month</li>
            <li><strong>Creator Growth</strong> — Email lists, sponsorships, brand deals, community building</li>
            <li><strong>AI for Creators</strong> — Practical AI workflows to save 10+ hours a week</li>
          </ul>
          <h2>Let's Connect</h2>
          <p>
            Follow me on{" "}
            <a href="https://www.linkedin.com/in/samdsingh/" target="_blank" rel="noopener noreferrer" className="text-blue-600">LinkedIn</a>{" "}
            for creator economy insights, or check out{" "}
            <GraphyLink utmContent="about-inline-link-2" className="text-brand-600">Graphy</GraphyLink>{" "}
            if you're ready to build your own course business. If you have a question about growing
            your creator business, read the blog — chances are I've covered it.
          </p>
        </div>

        <div className="mt-10 flex gap-4 flex-wrap">
          <Link href="/blog" className="btn-primary">Browse All Articles</Link>
          <a href="https://www.linkedin.com/in/samdsingh/" target="_blank" rel="noopener noreferrer" className="btn-secondary">
            Connect on LinkedIn
          </a>
          <GraphyLink utmContent="about-cta-bottom" className="btn-secondary">
            Try Graphy Free
          </GraphyLink>
        </div>
      </div>
    </div>
  );
}
