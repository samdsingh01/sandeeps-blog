/**
 * lib/analytics.ts
 * ================
 * Google Analytics 4 event tracking helpers.
 * Fires events via window.gtag (loaded by @next/third-parties/google in layout.tsx).
 *
 * Events tracked:
 *   cta_click     — every click on a Graphy.com CTA button
 *   outbound_link — any external link click
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Track a CTA click to Graphy.com.
 *
 * In GA4, look for:
 *   Events → cta_click
 *   Parameters: event_category="CTA", event_label=<label>, link_url=<url>
 *
 * @param label       — descriptive name e.g. "hero-cta", "author-bio-cta", "inline-cta"
 * @param destination — the full Graphy URL the user is navigating to
 */
export function trackCTAClick(label: string, destination: string): void {
  if (typeof window === 'undefined' || !window.gtag) return;
  window.gtag('event', 'cta_click', {
    event_category:  'CTA',
    event_label:     label,
    link_url:        destination,
    non_interaction: false,
  });
}

/**
 * Track a generic outbound link click.
 * GA4 auto-tracks outbound links, but this adds the specific URL as a label.
 */
export function trackOutboundLink(url: string): void {
  if (typeof window === 'undefined' || !window.gtag) return;
  window.gtag('event', 'click', {
    event_category:  'outbound',
    event_label:     url,
    transport_type:  'beacon',
  });
}
