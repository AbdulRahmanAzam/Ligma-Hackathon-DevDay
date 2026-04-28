export type CanvasMode = "select" | "sticky" | "rect" | "ellipse" | "arrow" | "pen";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
