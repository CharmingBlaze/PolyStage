/**
 * Compact per-stroke texel occupancy mask.
 * Avoids allocating millions of "x:y" strings on large paint canvases.
 */
export class StrokeTexelMask {
  private bits: Uint8Array;
  private w: number;
  private h: number;

  constructor(width: number, height: number) {
    this.w = Math.max(1, width | 0);
    this.h = Math.max(1, height | 0);
    this.bits = new Uint8Array(Math.ceil((this.w * this.h) / 8));
  }

  get width() {
    return this.w;
  }

  get height() {
    return this.h;
  }

  reset(width?: number, height?: number) {
    if (width != null && height != null && (width !== this.w || height !== this.h)) {
      this.w = Math.max(1, width | 0);
      this.h = Math.max(1, height | 0);
      this.bits = new Uint8Array(Math.ceil((this.w * this.h) / 8));
      return;
    }
    this.bits.fill(0);
  }

  has(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return true;
    const i = y * this.w + x;
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /** @returns true if newly marked */
  add(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const i = y * this.w + x;
    const byte = i >> 3;
    const bit = 1 << (i & 7);
    if (this.bits[byte] & bit) return false;
    this.bits[byte] |= bit;
    return true;
  }

  clear() {
    this.bits.fill(0);
  }
}
