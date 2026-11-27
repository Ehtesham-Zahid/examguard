/** True when the OS asks for reduced motion OR the user turned on "Reduce motion" in ExamGuard's settings. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) || document.documentElement.dataset.reduceMotion === 'true';
}
