import React, { useRef, useState } from 'react';

/** Clip/sequence length control: drag horizontally to scrub, click number to type (no spinner). */
export function LengthField({
  value,
  min = 0.5,
  snapStep = 0.01,
  onChange,
  label = 'Len',
  title,
}: {
  value: number;
  min?: number;
  snapStep?: number;
  onChange: (next: number) => void;
  label?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; origin: number; moved: boolean } | null>(null);

  const quantize = (v: number) => {
    const stepped = snapStep > 0 ? Math.round(v / snapStep) * snapStep : v;
    return Math.max(min, Math.round(stepped * 1000) / 1000);
  };

  const beginDrag = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('input')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, origin: value, moved: false };
  };

  const onDragMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    const sens = e.shiftKey ? 0.005 : 0.025;
    onChange(quantize(drag.origin + dx * sens));
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div
      className="flex items-center gap-1 h-6 px-1.5 rounded bg-[#121212] border border-[#e68619]/40 shrink-0 cursor-ew-resize select-none"
      title={title || 'Drag left/right to change length · click number to type · Shift = fine'}
      onPointerDown={beginDrag}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="text-[#e68619] font-bold pointer-events-none">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? value.toFixed(2)}
        onFocus={() => setDraft(value.toFixed(2))}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n)) onChange(quantize(n));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') setDraft(null);
          else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = quantize(value + (e.shiftKey ? snapStep : Math.max(snapStep * 10, 0.1)));
            onChange(next);
            setDraft(next.toFixed(2));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = quantize(value - (e.shiftKey ? snapStep : Math.max(snapStep * 10, 0.1)));
            onChange(next);
            setDraft(next.toFixed(2));
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-12 bg-transparent outline-none text-right text-[#e0e0e0] cursor-text caret-[#e68619]"
      />
      <span className="text-[#555] pointer-events-none">s</span>
    </div>
  );
}
