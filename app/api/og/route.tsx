/**
 * app/api/og/route.tsx
 * ====================
 * Generates editorial-style blog cover images using next/og (Satori).
 *
 * Design inspired by NP Digital's cover card style:
 *   ┌────────────────────────────────────┬──────────────────────┐
 *   │ · · · · ·                dark bg  │                      │
 *   │                                   │  AI-generated        │
 *   │  [CATEGORY]                       │  contextual image    │
 *   │                                   │  (right side only)   │
 *   │  BLOG TITLE IN LARGE              │                      │
 *   │  BOLD WHITE TEXT                  │◄─ diagonal accent    │
 *   │                                   │                      │
 *   │  [S] sandeeps.co · Creator Econ.  │                      │
 *   └────────────────────────────────────┴──────────────────────┘
 *
 * Usage:
 *   /api/og?title=How+to+Monetize+YouTube&category=YouTube+Monetization&bg=https://...
 *
 * Parameters:
 *   title    — blog post title (displayed large on left)
 *   category — post category (drives accent color and badge)
 *   bg       — URL of the AI-generated background image (shown on right)
 *
 * The bg image should already be in Supabase Storage (uploaded by agent/images.ts).
 * This route fetches it, converts to base64, and composites into the design.
 *
 * Cached at the edge for 1 year (images are stable once generated).
 */

import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';

export const runtime = 'edge';

// ── Category → accent colour map ──────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'YouTube Monetization':   '#ef4444',   // Red — energy, money, YouTube red
  'Course Creation':        '#8b5cf6',   // Purple — creativity, learning
  'Creator Growth':         '#3b82f6',   // Blue — trust, scale, analytics
  'Content Strategy':       '#f97316',   // Orange — ideas, planning, strategy
  'AI for Creator Economy': '#10b981',   // Green — tech, innovation, future
};

const FALLBACK_COLOR = '#667eea'; // brand purple

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);

  const title    = decodeURIComponent(searchParams.get('title')    ?? 'Untitled Post');
  const category = decodeURIComponent(searchParams.get('category') ?? 'Creator Growth');
  const bgUrl    = decodeURIComponent(searchParams.get('bg')       ?? '');

  const accent = CATEGORY_COLORS[category] ?? FALLBACK_COLOR;

  // Fetch the AI background image and convert to base64 data URI.
  // This is required because Satori fetches external images at render time,
  // and some Supabase storage URLs may have CORS restrictions.
  let bgDataUri: string | undefined;
  if (bgUrl) {
    try {
      const imgRes = await fetch(bgUrl, { cache: 'force-cache' });
      if (imgRes.ok) {
        const buf    = await imgRes.arrayBuffer();
        const bytes  = new Uint8Array(buf);
        let binary   = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const b64    = btoa(binary);
        const mime   = imgRes.headers.get('content-type') ?? 'image/jpeg';
        bgDataUri    = `data:${mime};base64,${b64}`;
      }
    } catch {
      // No background image — design still looks great with just the dark panel
    }
  }

  // Dynamic font size based on title length
  const titleLen = title.length;
  const fontSize  = titleLen > 65 ? 38 : titleLen > 50 ? 44 : titleLen > 35 ? 50 : 56;

  // Truncate category label to fit pill (Satori doesn't handle overflow well)
  const categoryLabel = category.length > 24 ? category.slice(0, 22) + '…' : category;

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width:           '1200px',
            height:          '630px',
            display:         'flex',
            backgroundColor: '#0c0c18',
            fontFamily:      '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
            overflow:        'hidden',
            position:        'relative',
          }}
        >
          {/* ── Right side: AI background image ─────────────────────────────── */}
          {bgDataUri && (
            <img
              src={bgDataUri}
              width={560}
              height={630}
              style={{
                position:    'absolute',
                right:       0,
                top:         0,
                objectFit:   'cover',
                objectPosition: 'center',
              }}
            />
          )}

          {/* ── Gradient fade from left panel into the image ─────────────────── */}
          <div
            style={{
              position:   'absolute',
              right:      0,
              top:        0,
              width:      '640px',
              height:     '630px',
              background: 'linear-gradient(to right, #0c0c18 0%, rgba(12,12,24,0.55) 55%, rgba(12,12,24,0.05) 100%)',
              zIndex:     2,
            }}
          />

          {/* ── Diagonal accent stripe (the signature NP Digital diagonal) ───── */}
          <div
            style={{
              position:        'absolute',
              left:            '618px',
              top:             '-120px',
              width:           '52px',
              height:          '900px',
              backgroundColor: accent,
              transform:       'rotate(5deg)',
              opacity:         0.9,
              zIndex:          3,
            }}
          />

          {/* ── Left content panel ───────────────────────────────────────────── */}
          <div
            style={{
              position:        'relative',
              zIndex:          10,
              display:         'flex',
              flexDirection:   'column',
              justifyContent:  'space-between',
              padding:         '44px 52px',
              width:           '640px',
              height:          '630px',
            }}
          >
            {/* Top: dot grid decoration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[0,1,2,3,4].map((i) => (
                  <div
                    key={i}
                    style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: accent, opacity: 0.7 }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[0,1,2,3].map((i) => (
                  <div
                    key={i}
                    style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: accent, opacity: 0.4 }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[0,1,2].map((i) => (
                  <div
                    key={i}
                    style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: accent, opacity: 0.2 }}
                  />
                ))}
              </div>
            </div>

            {/* Center: category badge + title ──────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Category pill */}
              <div
                style={{
                  display:         'flex',
                  alignItems:      'center',
                  backgroundColor: accent,
                  paddingTop:      '7px',
                  paddingBottom:   '7px',
                  paddingLeft:     '14px',
                  paddingRight:    '14px',
                  borderRadius:    '4px',
                  width:           'auto',
                  alignSelf:       'flex-start',
                }}
              >
                <span
                  style={{
                    color:          'white',
                    fontSize:       '11px',
                    fontWeight:     700,
                    letterSpacing:  '1.8px',
                    textTransform:  'uppercase',
                  }}
                >
                  {categoryLabel}
                </span>
              </div>

              {/* Title */}
              <div
                style={{
                  color:         'white',
                  fontSize:      `${fontSize}px`,
                  fontWeight:    900,
                  lineHeight:    1.15,
                  maxWidth:      '570px',
                  letterSpacing: '-0.5px',
                }}
              >
                {title}
              </div>
            </div>

            {/* Bottom: branding ─────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* Logo box */}
              <div
                style={{
                  backgroundColor: accent,
                  paddingTop:      '5px',
                  paddingBottom:   '5px',
                  paddingLeft:     '10px',
                  paddingRight:    '10px',
                  borderRadius:    '4px',
                  display:         'flex',
                  alignItems:      'center',
                }}
              >
                <span style={{ color: 'white', fontSize: '15px', fontWeight: 900 }}>S</span>
              </div>
              <span style={{ color: '#94a3b8', fontSize: '15px', fontWeight: 600 }}>
                sandeeps.co
              </span>
              <span style={{ color: '#334155', fontSize: '16px' }}>·</span>
              <span style={{ color: '#64748b', fontSize: '14px' }}>
                Creator Economy
              </span>
            </div>
          </div>

          {/* ── Corner accent box (top-right decoration) ─────────────────────── */}
          <div
            style={{
              position:        'absolute',
              top:             0,
              right:           0,
              width:           '80px',
              height:          '80px',
              backgroundColor: accent,
              opacity:         0.15,
              zIndex:          1,
            }}
          />
        </div>
      ),
      {
        width:  1200,
        height: 630,
        headers: {
          // Cache aggressively — these images are stable once generated
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      },
    );
  } catch (err) {
    console.error('[OG] ImageResponse failed:', err);
    // Fallback: plain dark image with title text only
    return new ImageResponse(
      (
        <div
          style={{
            width:           '1200px',
            height:          '630px',
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'flex-start',
            backgroundColor: '#0c0c18',
            padding:         '60px',
          }}
        >
          <div style={{ color: 'white', fontSize: '52px', fontWeight: 900, maxWidth: '1000px' }}>
            {title}
          </div>
        </div>
      ),
      { width: 1200, height: 630 },
    );
  }
}
