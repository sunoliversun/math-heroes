// Procedural PBR-ish textures drawn to canvas at runtime — no image files.
// Each biome gets a tiling albedo (color) map and a matching normal map so the
// ground catches light realistically. Textures are cached and reused.

import * as THREE from 'three';
import { makeNoise2D } from './noise.js';

const cache = new Map();

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Build a normal map from a height field by finite differences.
function heightToNormal(height, size) {
  const out = canvas(size);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = 2.0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const nz = 1.0;
      const len = Math.hypot(dx, dy, nz) || 1;
      const i = (y * size + x) * 4;
      img.data[i] = (dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function lerpColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Generate albedo + normal for a "grainy" ground (sand/snow/dirt) given two
// colors and a grain scale.
function grainyGround({ size = 384, low, high, scale = 12, seed = 1, grain = 0.5 }) {
  const noise = makeNoise2D(seed);
  const alb = canvas(size);
  const actx = alb.getContext('2d');
  const img = actx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // tileable sampling via wrap-around fbm coordinates
      const u = x / size, v = y / size;
      const n = (noise.fbm(u * scale, v * scale, 5) + 1) / 2;       // 0..1 broad
      const g = (noise.value(x * 0.7, y * 0.7) - 0.5) * grain;       // fine grain
      const t = Math.min(1, Math.max(0, n + g));
      const c = lerpColor(low, high, t);
      const i = (y * size + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      height[y * size + x] = t + g * 0.6;
    }
  }
  actx.putImageData(img, 0, 0);
  return { albedo: alb, normal: heightToNormal(height, size) };
}

// Rocky/cliff texture with sharper strata.
function rockGround({ size = 384, low, high, seed = 5 }) {
  const noise = makeNoise2D(seed);
  const alb = canvas(size);
  const actx = alb.getContext('2d');
  const img = actx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let n = (noise.fbm(u * 8, v * 8, 6, 2.3, 0.55) + 1) / 2;
      // cracks: dark thin veins
      const crack = Math.abs(noise.fbm(u * 16, v * 16, 3)) < 0.04 ? 0.45 : 1;
      const t = Math.min(1, n) * crack;
      const c = lerpColor(low, high, t);
      const i = (y * size + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      height[y * size + x] = t;
    }
  }
  actx.putImageData(img, 0, 0);
  return { albedo: alb, normal: heightToNormal(height, size) };
}

// Water normal map (ripples) — albedo handled by material color.
function waterNormal({ size = 256, seed = 9 }) {
  const noise = makeNoise2D(seed);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      height[y * size + x] = (noise.fbm(u * 10, v * 10, 4) + 1) / 2;
    }
  }
  return heightToNormal(height, size);
}

const RECIPES = {
  desert: () => grainyGround({ low: [196, 152, 86], high: [230, 200, 140], scale: 10, seed: 11, grain: 0.5 }),
  swamp:  () => grainyGround({ low: [54, 70, 44], high: [92, 110, 66], scale: 14, seed: 22, grain: 0.6 }),
  rocky:  () => rockGround({ low: [70, 72, 80], high: [140, 142, 150], seed: 33 }),
  forest: () => grainyGround({ low: [40, 86, 44], high: [86, 130, 66], scale: 16, seed: 44, grain: 0.55 }),
  ice:    () => grainyGround({ low: [184, 204, 222], high: [224, 236, 246], scale: 9, seed: 55, grain: 0.35 })
};

// Returns { map, normalMap } THREE textures for a biome, tiled & repeating.
export function groundTextures(biome, repeat = 26) {
  if (cache.has(biome)) return cache.get(biome);
  const recipe = RECIPES[biome] || RECIPES.desert;
  const { albedo, normal } = recipe();
  const map = new THREE.CanvasTexture(albedo);
  const normalMap = new THREE.CanvasTexture(normal);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  const result = { map, normalMap };
  cache.set(biome, result);
  return result;
}

export function makeWaterNormal(repeat = 8) {
  if (cache.has('_water')) return cache.get('_water');
  const tex = new THREE.CanvasTexture(waterNormal({}));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  cache.set('_water', tex);
  return tex;
}

// Bark texture for tree trunks.
export function barkTexture() {
  if (cache.has('_bark')) return cache.get('_bark');
  const size = 128;
  const noise = makeNoise2D(77);
  const alb = canvas(size);
  const ctx = alb.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = (noise.fbm(x / size * 4, y / size * 14, 4) + 1) / 2;
      const c = lerpColor([60, 40, 26], [110, 78, 50], v);
      const i = (y * size + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(alb);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('_bark', tex);
  return tex;
}
