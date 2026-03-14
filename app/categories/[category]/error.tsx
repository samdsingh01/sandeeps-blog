'use client';

import Link from 'next/link';
import { useEffect } from 'react';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CategoryError({ error, reset }: Props) {
  useEffect(() => {
    console.error('[CategoryError]', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">😔</div>
        <h1 className="text-2xl font-black text-gray-900 mb-3">
          Couldn&apos;t load this category
        </h1>
        <p className="text-gray-500 text-sm mb-6">
          There was a temporary error loading these posts. Try refreshing.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/blog"
            className="border border-gray-200 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            ← All Posts
          </Link>
        </div>
      </div>
    </div>
  );
}
