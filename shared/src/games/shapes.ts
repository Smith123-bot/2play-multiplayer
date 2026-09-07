/**
 * Canonical shape catalog for Shape Match Battle.
 *
 * Shared by the server (which picks targets and options) and the client
 * (which renders them), so both sides always agree on the vocabulary.
 * Everything is strictly 2D — simple SVG geometry, no images or 3D.
 */

export const SHAPE_FORMS = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'star',
  'hexagon',
  'cross',
  'ring',
] as const;

export type ShapeForm = (typeof SHAPE_FORMS)[number];

export const SHAPE_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'teal',
  'pink',
] as const;

export type ShapeColor = (typeof SHAPE_COLORS)[number];

/** A unique visual shape: geometric form × colour. */
export interface ShapeDescriptor {
  form: ShapeForm;
  color: ShapeColor;
}

export const OPTION_COUNT = 4;
