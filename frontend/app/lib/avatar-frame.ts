export interface AvatarPlacement {
  zoom: number;
  x: number;
  y: number;
}
export const initialPlacement: AvatarPlacement = { zoom: 1, x: 0, y: 0 };
export function avatarFrame(
  width: number,
  height: number,
  placement: AvatarPlacement,
  size = 128,
) {
  if (
    ![width, height, size, placement.zoom, placement.x, placement.y].every(
      Number.isFinite,
    ) ||
    width <= 0 ||
    height <= 0 ||
    size <= 0 ||
    placement.zoom < 1 ||
    placement.zoom > 4 ||
    Math.abs(placement.x) > 1 ||
    Math.abs(placement.y) > 1
  )
    throw new Error("Enquadramento inválido.");
  // At zoom 1 every corner lies inside the circular avatar, including portrait/landscape photos.
  const scale = (size / Math.hypot(width, height)) * placement.zoom;
  const drawWidth = width * scale,
    drawHeight = height * scale;
  return {
    width: drawWidth,
    height: drawHeight,
    left: (size - drawWidth) / 2 + (placement.x * size) / 2,
    top: (size - drawHeight) / 2 + (placement.y * size) / 2,
  };
}
