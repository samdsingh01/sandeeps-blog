"use client";
/**
 * GraphyLink.tsx
 * ==============
 * Use this component for ALL links to graphy.com.
 * It automatically reads the persisted UTM cookie and appends
 * the correct parameters to the destination URL.
 *
 * This component is FUTURE-PROOF:
 *   - UTM cookie logic lives in lib/utm.ts (one place to edit)
 *   - All GraphyLink usages inherit changes automatically
 *   - Never breaks — falls back to default UTMs if no cookie
 *
 * Usage:
 *   <GraphyLink>Try Graphy Free →</GraphyLink>
 *   <GraphyLink path="/pricing" utmContent="pricing-cta">View Pricing</GraphyLink>
 *   <GraphyLink path="/" utmCampaign="course-post" className="btn-primary">
 *     Start Your Course
 *   </GraphyLink>
 *
 * Props:
 *   path         - Graphy.com path (default: "/")
 *   utmSource    - Override utm_source
 *   utmMedium    - Override utm_medium
 *   utmCampaign  - Override utm_campaign
 *   utmContent   - Override utm_content (use to identify the specific CTA)
 *   utmTerm      - Override utm_term
 *   className    - CSS classes
 *   children     - Link text / content
 *   ...rest      - Any other <a> props
 */

import { useState, useEffect, useCallback } from "react";
import { buildGraphyURL, buildGraphyURLStatic, UTMParams } from "@/lib/utm";
import { trackCTAClick } from "@/lib/analytics";

interface GraphyLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  path?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  children: React.ReactNode;
}

export default function GraphyLink({
  path = "/",
  utmSource,
  utmMedium,
  utmCampaign,
  utmContent,
  utmTerm,
  className,
  children,
  ...rest
}: GraphyLinkProps) {
  // Start with static URL (works during SSR / before hydration)
  const overrides: Partial<UTMParams> = {};
  if (utmSource)   overrides.utm_source   = utmSource;
  if (utmMedium)   overrides.utm_medium   = utmMedium;
  if (utmCampaign) overrides.utm_campaign = utmCampaign;
  if (utmContent)  overrides.utm_content  = utmContent;
  if (utmTerm)     overrides.utm_term     = utmTerm;

  const [href, setHref] = useState(() => buildGraphyURLStatic(path, overrides));

  useEffect(() => {
    // On client: read cookie and build the full personalized URL
    setHref(buildGraphyURL(path, overrides));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, utmSource, utmMedium, utmCampaign, utmContent, utmTerm]);

  // Fire GA4 cta_click event on every click
  const handleClick = useCallback(() => {
    const label = utmContent ?? utmCampaign ?? 'graphy-link';
    trackCTAClick(label, href);
  }, [href, utmContent, utmCampaign]);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={handleClick}
      {...rest}
    >
      {children}
    </a>
  );
}
