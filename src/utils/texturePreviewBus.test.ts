import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetTexturePreviewBusForTests,
  getLiveTextureCanvas,
  getTexturePreviewTick,
  notifyTexturePreview,
  setLiveTextureCanvas,
  subscribeTexturePreview,
} from './texturePreviewBus';

describe('texturePreviewBus', () => {
  afterEach(() => {
    __resetTexturePreviewBusForTests();
  });

  it('tracks the live canvas identity for mid-stroke GPU rebind', () => {
    const a = { width: 8, height: 8 } as HTMLCanvasElement;
    const b = { width: 16, height: 16 } as HTMLCanvasElement;
    setLiveTextureCanvas(a);
    expect(getLiveTextureCanvas()).toBe(a);
    setLiveTextureCanvas(b);
    expect(getLiveTextureCanvas()).toBe(b);
  });

  it('sync notify flushes listeners immediately without waiting for rAF', () => {
    const fn = vi.fn();
    subscribeTexturePreview(fn);
    const before = getTexturePreviewTick();
    notifyTexturePreview({ sync: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getTexturePreviewTick()).toBe(before + 1);
  });

  it('sync notify cancels a pending coalesced rAF notify', () => {
    const fn = vi.fn();
    subscribeTexturePreview(fn);
    notifyTexturePreview();
    notifyTexturePreview({ sync: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
