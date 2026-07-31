import React, { useEffect, useRef, useState } from 'react';

export interface SmoothSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /**
   * Called once when the user releases the pointer (React state commit).
   * Do NOT put heavy setState here for every tick — use onLiveChange for previews.
   */
  onChange: (value: number) => void;
  /** Called during drag for cheap live previews (e.g. Three.js refs). No React state. */
  onLiveChange?: (value: number) => void;
  className?: string;
  accent?: string;
  title?: string;
  disabled?: boolean;
  /** Show the live numeric value on the right. */
  formatValue?: (value: number) => string;
}

/**
 * Commit-on-release slider for the animation editor.
 * Local value updates instantly; parent React state only updates on pointer-up.
 */
export const SmoothSlider: React.FC<SmoothSliderProps> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  onLiveChange,
  className = '',
  accent = '#ed7300',
  title,
  disabled = false,
  formatValue,
}) => {
  const [local, setLocal] = useState(value);
  const draggingRef = useRef(false);
  const localRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onLiveRef = useRef(onLiveChange);
  onChangeRef.current = onChange;
  onLiveRef.current = onLiveChange;

  useEffect(() => {
    if (!draggingRef.current) {
      setLocal(value);
      localRef.current = value;
    }
  }, [value]);

  const setLive = (n: number) => {
    localRef.current = n;
    setLocal(n);
    onLiveRef.current?.(n);
  };

  const commit = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const next = localRef.current;
    onLiveRef.current?.(next);
    onChangeRef.current(next);
  };

  const t = max === min ? 0 : (local - min) / (max - min);
  const pct = Math.max(0, Math.min(1, t)) * 100;

  return (
    <div className={`anim-smooth-slider-wrap ${className}`.trim()}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        title={title}
        className="anim-smooth-slider"
        style={{
          background: `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}%, #2a2a2a ${pct}%, #2a2a2a 100%)`,
          ['--anim-slider-accent' as string]: accent,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          draggingRef.current = true;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          // Jump-to-click immediately feels responsive
          const el = e.currentTarget;
          const rect = el.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
          const raw = min + ratio * (max - min);
          const stepped = step > 0 ? Math.round(raw / step) * step : raw;
          const n = Math.max(min, Math.min(max, Number(stepped.toFixed(6))));
          setLive(n);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          const el = e.currentTarget;
          const rect = el.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
          const raw = min + ratio * (max - min);
          const stepped = step > 0 ? Math.round(raw / step) * step : raw;
          const n = Math.max(min, Math.min(max, Number(stepped.toFixed(6))));
          if (n !== localRef.current) setLive(n);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          commit();
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }}
        onPointerCancel={(e) => {
          e.stopPropagation();
          commit();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        // Keep native change as fallback (keyboard / accessibility)
        onChange={(e) => {
          const n = Number(e.target.value);
          if (draggingRef.current) {
            setLive(n);
          } else {
            localRef.current = n;
            setLocal(n);
            onLiveRef.current?.(n);
            onChangeRef.current(n);
          }
        }}
      />
      {formatValue && (
        <span className="anim-smooth-slider-value">{formatValue(local)}</span>
      )}
    </div>
  );
};
