import { Calculator as CalcIcon, Eraser, NotebookPen, PenLine, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cx, Kbd } from '@/components/ui';

/**
 * Digital scratchpad (4.8): drawing canvas, plain-text notes and a calculator.
 * Autosaved per attempt (locally + server), never graded, visible to the examiner only as context.
 */
export function Scratchpad({ open, onClose, initial, onSave }: { open: boolean; onClose: () => void; initial: { canvas: string; notes: string } | null; onSave: (d: { canvas?: string; notes?: string }) => void }) {
  const [tab, setTab] = useState<'draw' | 'notes' | 'calc'>('draw');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const history = useRef<ImageData[]>([]);
  const drawing = useRef(false);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('ink');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  const scheduleSave = useCallback(
    (d: { canvas?: string; notes?: string }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => onSave(d), 1500);
    },
    [onSave],
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || loaded.current || !open) return;
    loaded.current = true;
    const ctx = c.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    ctx.scale(ratio, ratio);
    if (initial?.canvas) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.clientWidth, c.clientHeight);
      img.src = initial.canvas;
    }
  }, [open, initial, tab]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const strokeColor = () => {
    const cs = getComputedStyle(document.documentElement);
    return color === 'ink' ? cs.getPropertyValue('--ink') : color === 'accent' ? cs.getPropertyValue('--info') : cs.getPropertyValue('--danger');
  };
  const down = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    history.current.push(ctx.getImageData(0, 0, c.width, c.height));
    if (history.current.length > 30) history.current.shift();
    drawing.current = true;
    c.setPointerCapture(e.pointerId);
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = strokeColor();
    ctx.lineWidth = tool === 'eraser' ? 18 : 2.2 * (e.pressure ? 0.6 + e.pressure : 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    scheduleSave({ canvas: canvasRef.current!.toDataURL('image/png') });
  };
  const undo = () => {
    const c = canvasRef.current!;
    const prev = history.current.pop();
    if (prev) c.getContext('2d')!.putImageData(prev, 0, 0);
    scheduleSave({ canvas: c.toDataURL('image/png') });
  };
  const clear = () => {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    history.current.push(ctx.getImageData(0, 0, c.width, c.height));
    ctx.clearRect(0, 0, c.width, c.height);
    scheduleSave({ canvas: c.toDataURL('image/png') });
  };

  return (
    <aside
      aria-label="Scratchpad"
      aria-hidden={!open}
      inert={!open}
      className={cx('fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-200', open ? 'translate-x-0' : 'pointer-events-none translate-x-full')}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Scratchpad</h2>
          <p className="text-xs text-muted">Rough work — saved automatically, never graded.</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-surface-2" aria-label="Close scratchpad">
          <X className="size-5" />
        </button>
      </div>
      <div className="flex gap-1 border-b border-line px-3 py-2" role="tablist">
        {(
          [
            ['draw', 'Draw', <PenLine key="d" className="size-4" />],
            ['notes', 'Notes', <NotebookPen key="n" className="size-4" />],
            ['calc', 'Calculator', <CalcIcon key="c" className="size-4" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm', tab === id ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2')}>
            {icon}
            {label}
          </button>
        ))}
      </div>
      <div className={cx('flex min-h-0 flex-1 flex-col', tab !== 'draw' && 'hidden')}>
        <div className="flex items-center gap-1 border-b border-line px-3 py-2">
          <button onClick={() => setTool('pen')} aria-pressed={tool === 'pen'} className={cx('rounded-md p-2', tool === 'pen' ? 'bg-surface-2 text-ink' : 'text-muted')} aria-label="Pen">
            <PenLine className="size-4" />
          </button>
          <button onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'} className={cx('rounded-md p-2', tool === 'eraser' ? 'bg-surface-2 text-ink' : 'text-muted')} aria-label="Eraser">
            <Eraser className="size-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-line" />
          {(['ink', 'accent', 'danger'] as const).map((c) => (
            <button key={c} onClick={() => { setColor(c); setTool('pen'); }} aria-label={`${c === 'ink' ? 'Black' : c === 'accent' ? 'Blue' : 'Red'} pen`} aria-pressed={color === c} className={cx('size-6 rounded-full border-2', color === c ? 'border-ink' : 'border-transparent')} style={{ background: c === 'ink' ? 'var(--ink)' : c === 'accent' ? 'var(--info)' : 'var(--danger)' }} />
          ))}
          <span className="ml-auto" />
          <button onClick={undo} className="rounded-md p-2 text-muted hover:bg-surface-2" aria-label="Undo">
            <Undo2 className="size-4" />
          </button>
          <button onClick={clear} className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Clear canvas">
            <Trash2 className="size-4" />
          </button>
        </div>
        <canvas ref={canvasRef} className="paper-grid min-h-0 flex-1 touch-none bg-surface" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Drawing canvas for rough work" />
      </div>
      {tab === 'notes' && (
        <div className="flex flex-1 flex-col p-3" data-allow-clipboard>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              scheduleSave({ notes: e.target.value });
            }}
            placeholder="Type rough notes, working, or reminders here…"
            className="exam-text flex-1 resize-none rounded-lg border border-line bg-surface-2 p-3 outline-none focus:border-accent"
            aria-label="Scratchpad notes"
          />
        </div>
      )}
      {tab === 'calc' && <Calculator />}
      <div className="border-t border-line px-4 py-2 text-xs text-muted">
        Toggle with <Kbd>S</Kbd>
      </div>
    </aside>
  );
}

function Calculator() {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState<string>('');
  const evaluate = (s: string) => {
    // safe evaluator: digits, operators, parentheses, decimal, sqrt/pow via ^ — no eval()
    try {
      const tokens = s.replace(/\s+/g, '').match(/\d+\.?\d*|\.\d+|[()+\-*/^%]|√/g);
      if (!tokens) return '';
      let i = 0;
      const peek = () => tokens[i];
      const next = () => tokens[i++];
      const factor = (): number => {
        const t = next();
        if (t === '(') {
          const v = expr2();
          next();
          return v;
        }
        if (t === '-') return -factor();
        if (t === '√') return Math.sqrt(factor());
        const n = Number(t);
        if (Number.isNaN(n)) throw new Error();
        return n;
      };
      const power = (): number => {
        let v = factor();
        while (peek() === '^') {
          next();
          v = Math.pow(v, factor());
        }
        return v;
      };
      const term = (): number => {
        let v = power();
        while (['*', '/', '%'].includes(peek())) {
          const op = next();
          const r = power();
          v = op === '*' ? v * r : op === '/' ? v / r : v % r;
        }
        return v;
      };
      const expr2 = (): number => {
        let v = term();
        while (['+', '-'].includes(peek())) {
          const op = next();
          const r = term();
          v = op === '+' ? v + r : v - r;
        }
        return v;
      };
      const v = expr2();
      return Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : 'Error';
    } catch {
      return 'Error';
    }
  };
  const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '^', '+', '(', ')', '√', '%'];
  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      <div className="rounded-lg border border-line bg-surface-2 p-3 text-right">
        <input value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setResult(evaluate(expr))} className="w-full bg-transparent text-right font-mono text-lg outline-none" aria-label="Calculator expression" placeholder="0" />
        <div className="tabular min-h-7 font-mono text-2xl font-semibold" aria-live="polite">
          {result}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {keys.map((k) => (
          <button key={k} onClick={() => setExpr((x) => x + k)} className="h-11 rounded-lg bg-surface-2 font-mono text-base hover:bg-line">
            {k}
          </button>
        ))}
        <button onClick={() => { setExpr(''); setResult(''); }} className="col-span-2 h-11 rounded-lg bg-danger-soft font-medium text-danger">
          Clear
        </button>
        <button onClick={() => setResult(evaluate(expr))} className="col-span-2 h-11 rounded-lg bg-accent font-medium text-accent-ink">
          =
        </button>
      </div>
    </div>
  );
}
