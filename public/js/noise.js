// Lightweight seedable 2-D value noise + fractal Brownian motion (fbm).
// Used for terrain height and procedural textures. No dependencies.

function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295; // 0..1
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function makeNoise2D(seed = 1) {
  const s = seed >>> 0;
  function value(x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const v00 = hash2(x0, z0, s);
    const v10 = hash2(x0 + 1, z0, s);
    const v01 = hash2(x0, z0 + 1, s);
    const v11 = hash2(x0 + 1, z0 + 1, s);
    const ux = smooth(fx), uz = smooth(fz);
    const a = v00 + (v10 - v00) * ux;
    const b = v01 + (v11 - v01) * ux;
    return a + (b - a) * uz; // 0..1
  }
  // Fractal sum: several octaves of value noise. Returns roughly -1..1.
  function fbm(x, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * (value(x * freq, z * freq) * 2 - 1);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
  return { value, fbm };
}
