"use client";
/**
 * UTMProvider.tsx
 * ================
 * Drop this once in the root layout. It runs client-side on every page load and:
 *   1. Reads UTM params from the current URL
 *   2. Saves them to the `cl_utm` cookie (30-day expiry)
 *
 * This ensures that if a visitor arrives via:
 *   ?utm_source=youtube&utm_medium=video&utm_campaign=monetize-guide
 * ...those params are stored and will be appended to any Graphy.com link
 * they click anywhere on the site, even on a later page visit.
 *
 * Usage (in app/layout.tsx):
 *   import UTMProvider from '@/components/UTMProvider';
 *   // Inside <body>:
 *   <UTMProvider />
 */

import { useEffect } from "react";
import { saveUTMToCookie } from "@/lib/utm";

export default function UTMProvider() {
  useEffect(() => {
    // Capture + persist UTMs on every client-side navigation
    saveUTMToCookie();
  }, []);

  // Renders nothing — purely a side-effect component
  return null;
}
