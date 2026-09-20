/**
 * Blender-style constrained grab: mouse motion along an axis as it appears
 * on screen maps 1:1 to world units along that axis.
 */
export function amountAlongProjectedAxis(
  originNdc: { x: number; y: number },
  axisTipNdc: { x: number; y: number },
  startPx: { x: number; y: number },
  nowPx: { x: number; y: number },
  viewW: number,
  viewH: number,
): number {
  const toScreen = (ndc: { x: number; y: number }) => ({
    x: ((ndc.x + 1) * 0.5) * viewW,
    y: ((1 - ndc.y) * 0.5) * viewH,
  });
  const a = toScreen(originNdc);
  const b = toScreen(axisTipNdc);
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const slen2 = sx * sx + sy * sy;
  if (slen2 < 1) {
    const mdx = nowPx.x - startPx.x;
    const mdy = nowPx.y - startPx.y;
    return (mdx - mdy) * 0.01;
  }
  const mdx = nowPx.x - startPx.x;
  const mdy = nowPx.y - startPx.y;
  return (mdx * sx + mdy * sy) / slen2;
}
