import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { cx } from '@/components/ui';

/** Fades + rises its content into view the first time it scrolls on screen. */
export function Reveal({ children, delay = 0, className, as: Tag = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: ElementType }) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={cx('reveal', seen && 'is-visible', className)} style={{ ['--d' as string]: `${delay}s` }}>
      {children}
    </Tag>
  );
}

/** True once the element has been on screen (for kicking off animations). */
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setInView(true), io.disconnect()), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

export function SectionHead({ eyebrow, title, sub, center }: { eyebrow: string; title: ReactNode; sub?: ReactNode; center?: boolean }) {
  return (
    <Reveal className={cx('mb-12 max-w-2xl', center && 'mx-auto text-center')}>
      <div className={cx('mb-3 flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-2', center && 'justify-center')}>
        <span className="h-[2px] w-6 rounded bg-margin" aria-hidden />
        {eyebrow}
      </div>
      <h2 className="display text-[34px] font-bold leading-[1.08] sm:text-[44px]">{title}</h2>
      {sub && <p className="mt-4 text-[17px] leading-relaxed text-ink-2">{sub}</p>}
    </Reveal>
  );
}
