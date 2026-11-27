import { Fragment, type ReactNode } from 'react';

/** Tiny safe renderer: ```code blocks```, `inline code`, **bold**, line breaks. No HTML injection possible. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/```/);
  return (
    <div className={className}>
      {blocks.map((b, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="my-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[0.85em] leading-relaxed">
            {b.replace(/^\w*\n/, '')}
          </pre>
        ) : (
          <Fragment key={i}>
            {b.split('\n').map((line, j, arr) => (
              <Fragment key={j}>
                {inline(line)}
                {j < arr.length - 1 && <br />}
              </Fragment>
            ))}
          </Fragment>
        ),
      )}
    </div>
  );
}
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('`') ? <code key={k++} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.88em]">{t.slice(1, -1)}</code> : <strong key={k++}>{t.slice(2, -2)}</strong>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
