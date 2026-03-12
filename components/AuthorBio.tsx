"use client";
import GraphyLink from "@/components/GraphyLink";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

interface AuthorBioProps {
  compact?: boolean;
}

// AuthorAvatar: shows real photo with graceful SVG fallback
function AuthorAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const [imgError, setImgError] = useState(false);

  const sizeMap = {
    sm: { outer: "w-10 h-10", text: "text-sm", px: 40 },
    md: { outer: "w-16 h-16", text: "text-xl", px: 64 },
    lg: { outer: "w-24 h-24", text: "text-2xl", px: 96 },
  };
  const s = sizeMap[size];

  if (!imgError) {
    return (
      <div className={`${s.outer} rounded-full overflow-hidden flex-shrink-0 ring-2 ring-brand-200`}>
        <Image
          src="/images/author/sandeep.jpg"
          alt="Sandeep Singh — Co-founder, Graphy.com"
          width={s.px}
          height={s.px}
          className="w-full h-full object-cover object-top"
          onError={() => setImgError(true)}
          priority
        />
      </div>
    );
  }

  // Fallback: SVG illustrated avatar
  return (
    <div className={`${s.outer} rounded-full overflow-hidden flex-shrink-0 ring-2 ring-brand-200`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/author/sandeep-placeholder.svg"
        alt="Sandeep Singh"
        className="w-full h-full object-cover"
      />
    </div>
  );
}

export default function AuthorBio({ compact = false }: AuthorBioProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <AuthorAvatar size="sm" />
        <div>
          <p className="font-semibold text-sm text-gray-900">Sandeep Singh</p>
          <p className="text-xs text-gray-500">Co-founder, Graphy.com</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-brand-50 to-white border border-brand-100 rounded-2xl p-6 sm:p-8">
      <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
        <AuthorAvatar size="md" />
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-bold text-lg text-gray-900">Sandeep Singh</h3>
            <span className="category-badge">Co-founder</span>
          </div>
          <p className="text-sm text-gray-500 mb-1">
            Co-founder at <strong className="text-brand-600">Graphy.com</strong>
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            Sandeep has helped thousands of creators launch profitable online courses and YouTube channels.
            He co-founded Graphy.com — a no-code platform that lets creators build, host, and sell online
            courses without tech headaches. He writes about the creator economy, YouTube growth, and
            practical monetization strategies.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="https://www.linkedin.com/in/samdsingh/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              💼 LinkedIn
            </a>
            <GraphyLink
              utmContent="author-bio-cta"
              className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              🌐 graphy.com
            </GraphyLink>
            <Link href="/about" className="text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors">
              More about Sandeep →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
