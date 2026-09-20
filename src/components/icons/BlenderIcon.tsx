/**
 * Toolbar glyphs. Object/Vertex/Edge/Face use cropped Blender 4.4 icons_svg
 * (GPL-2.0+). Modeling/gizmo icons are original 16x16 PolyStage SVGs
 * (public/icons/model, MIT). Colored with currentColor via CSS mask.
 */
import type { HTMLAttributes } from 'react';

export type BlenderIconName =
  | 'object'
  | 'vertex'
  | 'edge'
  | 'face'
  | 'bone'
  | 'pose'
  | 'skin'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'transform'
  | 'pivot'
  | 'orientationLocal'
  | 'orientationGlobal'
  | 'center'
  | 'select'
  | 'deselect'
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'picker'
  | 'spray'
  | 'dither'
  | 'extrude'
  | 'inset'
  | 'bevel'
  | 'loopCut'
  | 'knife'
  | 'cad'
  | 'pen'
  | 'weld'
  | 'mirror'
  | 'magnet'
  | 'uv'
  | 'outliner'
  | 'mesh'
  | 'scene'
  | 'import'
  | 'undo'
  | 'redo'
  | 'quad'
  | 'single'
  | 'shading'
  | 'help'
  | 'hide'
  | 'show'
  | 'tools'
  | 'primitives'
  | 'blockout'
  | 'anim'
  | 'settings'
  | 'add'
  | 'rename'
  | 'trash'
  | 'subsurf'
  | 'boolean'
  | 'camera'
  | 'light'
  | 'zoom'
  | 'maximize'
  | 'cursor';

const FILES: Record<BlenderIconName, string> = {
  object: '/blender-icons/mesh_cube.svg',
  vertex: '/blender-icons/vertexsel.svg',
  edge: '/blender-icons/edgesel.svg',
  face: '/blender-icons/facesel.svg',
  bone: '/blender-icons/bone_data.svg',
  pose: '/icons/model/pose.svg',
  skin: '/blender-icons/wpaint_hlt.svg',
  transform: '/icons/model/transform.svg',
  move: '/icons/model/move.svg',
  rotate: '/icons/model/rotate.svg',
  scale: '/icons/model/scale.svg',
  pivot: '/icons/model/pivot.svg',
  orientationLocal: '/icons/model/orientation-local.svg',
  orientationGlobal: '/icons/model/orientation-global.svg',
  center: '/icons/model/center.svg',
  select: '/blender-icons/select_set.svg',
  deselect: '/blender-icons/select_subtract.svg',
  brush: '/blender-icons/tpaint_hlt.svg',
  eraser: '/blender-icons/remove.svg',
  fill: '/blender-icons/gp_draw_fill.svg',
  picker: '/blender-icons/eyedropper.svg',
  spray: '/blender-icons/greasepencil.svg',
  dither: '/blender-icons/image_alpha.svg',
  extrude: '/icons/model/extrude.svg',
  inset: '/icons/model/inset.svg',
  bevel: '/icons/model/bevel.svg',
  loopCut: '/icons/model/loopcut.svg',
  knife: '/icons/model/knife.svg',
  cad: '/icons/model/cad.svg',
  pen: '/blender-icons/greasepencil.svg',
  weld: '/icons/model/weld.svg',
  mirror: '/icons/model/mirror.svg',
  magnet: '/icons/model/snap.svg',
  uv: '/blender-icons/uv.svg',
  outliner: '/icons/model/outliner.svg',
  mesh: '/blender-icons/mesh_data.svg',
  scene: '/blender-icons/object_datamode.svg',
  import: '/blender-icons/import.svg',
  undo: '/blender-icons/file_refresh.svg',
  redo: '/blender-icons/file_new.svg',
  quad: '/blender-icons/gizmo.svg',
  single: '/icons/model/pivot.svg',
  shading: '/blender-icons/object_datamode.svg',
  help: '/blender-icons/help.svg',
  hide: '/blender-icons/restrict_select_off.svg',
  show: '/blender-icons/select_extend.svg',
  tools: '/blender-icons/tool_settings.svg',
  primitives: '/blender-icons/mesh_cube.svg',
  blockout: '/blender-icons/greasepencil.svg',
  anim: '/blender-icons/file_refresh.svg',
  settings: '/blender-icons/overlay.svg',
  add: '/icons/model/add.svg',
  rename: '/blender-icons/file_new.svg',
  trash: '/icons/model/trash.svg',
  subsurf: '/blender-icons/mod_subsurf.svg',
  boolean: '/blender-icons/mod_boolean.svg',
  cursor: '/blender-icons/cursor.svg',
  camera: '/icons/model/camera.svg',
  light: '/icons/model/light.svg',
  zoom: '/icons/model/zoom.svg',
  maximize: '/icons/model/maximize.svg',
};

type Props = HTMLAttributes<HTMLSpanElement> & {
  name: BlenderIconName;
  size?: number;
};

export function BlenderIcon({ name, size = 16, className, style, ...rest }: Props) {
  const src = FILES[name];
  return (
    <span
      {...rest}
      aria-hidden
      className={`b-icon ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
        ...style,
      }}
    />
  );
}
