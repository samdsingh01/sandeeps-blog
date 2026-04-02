/**
 * app/api/og/route.tsx
 * ====================
 * Premium editorial blog cover image generator using next/og (Satori).
 *
 * DESIGN PHILOSOPHY (based on top-performing blog covers research):
 * ─────────────────────────────────────────────────────────────────
 * • Title IS the design — biggest element, can't miss it at thumbnail size
 * • Max 3 visual elements (background + title + decorative accent)
 * • 4.5:1 contrast ratio minimum for WCAG compliance + social compression
 * • Category-specific rich gradients → instant visual differentiation
 * • Deterministic variety: gradient angle + accent circle shift by title hash
 *   so two posts in the same category still look visually distinct
 * • Reads perfectly at 300px wide (Twitter card, LinkedIn thumbnail)
 *
 * CATEGORY VISUAL IDENTITY:
 *   YouTube Monetization  →  YouTube Red   gradient, 💰 icon watermark
 *   Course Creation       →  Deep Violet   gradient, 🎓 icon watermark
 *   Creator Growth        →  Electric Blue gradient, 📈 icon watermark
 *   Content Strategy      →  Burnt Orange  gradient, 🗂️ icon watermark
 *   AI for Creator Economy → Deep Emerald gradient, ⚡ icon watermark
 *
 * USAGE:
 *   /api/og?title=How+to+Monetize+Your+YouTube+Channel&category=YouTube+Monetization&bg=https://...
 *
 * The `bg` param is optional — design looks great without it.
 * When provided, it appears as a very subtle right-side texture (8% opacity).
 * Cached at edge for 1 year once generated.
 */

import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';

export const runtime = 'edge';

// ── Category design tokens ─────────────────────────────────────────────────────

interface CategoryDesign {
  /** Primary accent colour (badge, underline, ring border) */
  accent:      string;
  /** Lighter tint of the accent for glows */
  accentLight: string;
  /** Rich dark hue for the gradient start (left/source side) */
  gradientRich: string;
  /** Near-black for the gradient end */
  gradientDark: string;
  /** Large watermark emoji — rendered at low opacity behind the title */
  icon:         string;
}

const CATEGORY: Record<string, CategoryDesign> = {
  'YouTube Monetization': {
    accent:       '#FF3B30',
    accentLight:  '#FF6B6B',
    gradientRich: '#4a0000',
    gradientDark: '#0c0c18',
    icon:         '💰',
  },
  'Course Creation': {
    accent:       '#8b5cf6',
    accentLight:  '#a78bfa',
    gradientRich: '#1e0040',
    gradientDark: '#0c0c18',
    icon:         '🎓',
  },
  'Creator Growth': {
    accent:       '#2563eb',
    accentLight:  '#60a5fa',
    gradientRich: '#001133',
    gradientDark: '#0c0c18',
    icon:         '📈',
  },
  'Content Strategy': {
    accent:       '#ea580c',
    accentLight:  '#fb923c',
    gradientRich: '#3d1000',
    gradientDark: '#0c0c18',
    icon:         '🗂️',
  },
  'AI for Creator Economy': {
    accent:       '#059669',
    accentLight:  '#34d399',
    gradientRich: '#001a0d',
    gradientDark: '#0c0c18',
    icon:         '⚡',
  },
};

const FALLBACK_DESIGN: CategoryDesign = {
  accent:       '#7c3aed',
  accentLight:  '#a78bfa',
  gradientRich: '#1a0040',
  gradientDark: '#0c0c18',
  icon:         '🚀',
};

// ── Deterministic hash (for per-post visual variation) ─────────────────────────

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);

  const title    = decodeURIComponent(searchParams.get('title')    ?? 'Untitled Post');
  const category = decodeURIComponent(searchParams.get('category') ?? 'Creator Growth');
  const bgUrl    = decodeURIComponent(searchParams.get('bg')       ?? '');

  const design = CATEGORY[category] ?? FALLBACK_DESIGN;

  // ── Per-post deterministic variation ─────────────────────────────────────────
  // Same category, different post → different gradient angle + circle offset.
  // Makes every cover feel unique without being random.
  const h             = djb2(title);
  const gradientAngle = 110 + (h % 70);            // 110° – 180°
  const circleTop     = -80  + (h % 120);          // -80 to +40 from top
  const circleRight   = -60  + ((h >> 4) % 100);   // -60 to +40 from right
  const circleSize    = 380  + ((h >> 8) % 200);   // 380 – 580 px diameter
  const ringSize      = circleSize + 60;
  const iconOpacity   = 0.06 + ((h % 40) / 1000);  // 0.06 – 0.10

  // ── Font sizing: title is always the biggest readable element ─────────────────
  const len      = title.length;
  const fontSize = len > 70 ? 40 : len > 55 ? 48 : len > 40 ? 56 : len > 28 ? 64 : 72;

  // ── Optional AI background texture (very subtle — design is self-sufficient) ──
  let bgDataUri: string | undefined;
  if (bgUrl) {
    try {
      const r = await fetch(bgUrl, { cache: 'force-cache' });
      if (r.ok) {
        const buf  = await r.arrayBuffer();
        const u8   = new Uint8Array(buf);
        let bin    = '';
        // eslint-disable-next-line no-plusplus
        for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
        const mime = r.headers.get('content-type') ?? 'image/jpeg';
        bgDataUri  = `data:${mime};base64,${btoa(bin)}`;
      }
    } catch {
      // Non-critical — card still looks great without it
    }
  }

  // ── Category badge label (truncate long names to fit pill) ────────────────────
  const badgeLabel = category.length > 26 ? `${category.slice(0, 24)}…` : category;

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width:        '1200px',
            height:       '630px',
            display:      'flex',
            flexDirection: 'column',
            position:     'relative',
            overflow:     'hidden',
            fontFamily:   '-apple-system, "Helvetica Neue", Arial, sans-serif',
            // Rich dark gradient — unique angle per post
            background:   `linear-gradient(${gradientAngle}deg, ${design.gradientRich} 0%, ${design.gradientDark} 65%, #080810 100%)`,
          }}
        >
          {/* ── Subtle AI image texture top-right (if available) ─────────────── */}
          {bgDataUri && (
            <img
              src={bgDataUri}
              width={600}
              height={630}
              style={{
                position:       'absolute',
                right:          0,
                top:            0,
                objectFit:      'cover',
                objectPosition: 'center',
                opacity:        0.08,
                // Blend with gradient by fading left edge
              }}
            />
          )}

          {/* ── Radial glow behind the decorative circle ─────────────────────── */}
          <div
            style={{
              position:     'absolute',
              right:        `${circleRight - circleSize / 2}px`,
              top:          `${circleTop - circleSize / 2}px`,
              width:        `${circleSize * 2}px`,
              height:       `${circleSize * 2}px`,
              borderRadius: '50%',
              background:   `radial-gradient(circle, ${design.accent}28 0%, ${design.accent}08 50%, transparent 70%)`,
            }}
          />

          {/* ── Decorative ring (outline circle) — top-right corner ───────────── */}
          <div
            style={{
              position:     'absolute',
              right:        `${circleRight}px`,
              top:          `${circleTop}px`,
              width:        `${ringSize}px`,
              height:       `${ringSize}px`,
              borderRadius: '50%',
              border:       `2px solid ${design.accent}40`,
            }}
          />
          {/* Inner ring */}
          <div
            style={{
              position:     'absolute',
              right:        `${circleRight + 40}px`,
              top:          `${circleTop + 40}px`,
              width:        `${circleSize - 20}px`,
              height:       `${circleSize - 20}px`,
              borderRadius: '50%',
              border:       `1px solid ${design.accent}25`,
            }}
          />

          {/* ── Giant icon watermark — category visual identity at low opacity ── */}
          <div
            style={{
              position:  'absolute',
              right:     '60px',
              bottom:    '60px',
              fontSize:  '220px',
              opacity:   iconOpacity,
              lineHeight: 1,
            }}
          >
            {design.icon}
          </div>

          {/* ── Left vertical accent bar (colour pop element) ────────────────── */}
          <div
            style={{
              position:        'absolute',
              left:            0,
              top:             '15%',
              width:           '5px',
              height:          '70%',
              backgroundColor: design.accent,
              borderRadius:    '0 3px 3px 0',
              opacity:         0.9,
            }}
          />

          {/* ── MAIN CONTENT (flex column, takes full card) ───────────────────── */}
          <div
            style={{
              display:        'flex',
              flexDirection:  'column',
              justifyContent: 'space-between',
              height:         '100%',
              padding:        '52px 80px 52px 70px',
              position:       'relative',
              zIndex:         10,
            }}
          >
            {/* TOP: category badge */}
            <div style={{ display: 'flex' }}>
              <div
                style={{
                  display:         'flex',
                  alignItems:      'center',
                  backgroundColor: design.accent,
                  paddingTop:      '7px',
                  paddingBottom:   '7px',
                  paddingLeft:     '16px',
                  paddingRight:    '16px',
                  borderRadius:    '4px',
                }}
              >
                <span
                  style={{
                    color:         'white',
                    fontSize:      '12px',
                    fontWeight:    800,
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                  }}
                >
                  {badgeLabel}
                </span>
              </div>
            </div>

            {/* CENTER: THE TITLE — this is the entire point of the card */}
            <div
              style={{
                display:       'flex',
                flexDirection: 'column',
                gap:           '20px',
                maxWidth:      '1000px',
              }}
            >
              <div
                style={{
                  color:         'white',
                  fontSize:      `${fontSize}px`,
                  fontWeight:    900,
                  lineHeight:    1.18,
                  letterSpacing: '-0.03em',
                  // Text shadow for depth — helps readability over gradient
                  textShadow:    `0 2px 30px rgba(0,0,0,0.6)`,
                }}
              >
                {title}
              </div>

              {/* Accent underline — signature brand element */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div
                  style={{
                    width:           '56px',
                    height:          '4px',
                    backgroundColor: design.accent,
                    borderRadius:    '2px',
                  }}
                />
                <div
                  style={{
                    width:           '20px',
                    height:          '4px',
                    backgroundColor: design.accentLight,
                    borderRadius:    '2px',
                    opacity:         0.5,
                  }}
                />
              </div>
            </div>

            {/* BOTTOM: branding strip */}
            <div
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
              }}
            >
              {/* Left: logo + site name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* S badge */}
                <div
                  style={{
                    display:         'flex',
                    alignItems:      'center',
                    justifyContent:  'center',
                    width:           '36px',
                    height:          '36px',
                    backgroundColor: design.accent,
                    borderRadius:    '6px',
                  }}
                >
                  <span style={{ color: 'white', fontSize: '18px', fontWeight: 900 }}>S</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <span style={{ color: '#f1f5f9', fontSize: '16px', fontWeight: 700 }}>
                    sandeeps.co
                  </span>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>
                    Creator Economy
                  </span>
                </div>
              </div>

              {/* Right: year + subtle icon */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width:           '1px',
                    height:          '28px',
                    backgroundColor: '#334155',
                  }}
                />
                <span style={{ color: '#475569', fontSize: '14px' }}>
                  {new Date().getFullYear()}
                </span>
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width:  1200,
        height: 630,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      },
    );
  } catch (err) {
    console.error('[OG] Render failed:', err);
    // Minimal fallback — always returns something usable
    return new ImageResponse(
      (
        <div
          style={{
            width:           '1200px',
            height:          '630px',
            display:         'flex',
            alignItems:      'center',
            padding:         '80px',
            background:      `linear-gradient(135deg, ${(CATEGORY[category] ?? FALLBACK_DESIGN).gradientRich} 0%, #080810 100%)`,
            fontFamily:      'sans-serif',
          }}
        >
          <span
            style={{
              color:      'white',
              fontSize:   '56px',
              fontWeight: 900,
              lineHeight: 1.2,
              maxWidth:   '1040px',
            }}
          >
            {title}
          </span>
        </div>
      ),
      { width: 1200, height: 630 },
    );
  }
}
