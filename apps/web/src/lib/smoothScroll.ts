import Lenis from 'lenis';
import { useEffect } from 'react';
import { prefersReducedMotion } from './motion';

/**
 * Inertia ("buttery") page scrolling for marketing pages. Native scroll position is still used,
 * so scroll listeners, sticky headers and IntersectionObservers keep working. Touch devices keep
 * their native momentum scrolling, and reduced-motion users get plain scrolling.
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.09, // lower = glidier
      wheelMultiplier: 1,
      smoothWheel: true,
      // in-page links (#features, #resilience…) glide too, stopping below the sticky nav
      anchors: { offset: -80, duration: 1.2 },
    });
    return () => lenis.destroy();
  }, []);
}
