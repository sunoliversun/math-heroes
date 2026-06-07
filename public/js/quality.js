// Adaptive graphics quality. Browser 3D renders on the player's own device, so
// the photoreal look (HDRI sky + PBR + GTAO + bloom + big shadows) can overwhelm
// a modest laptop GPU. This module picks a sensible tier per device, lets the
// player override it, and lets a runtime FPS watchdog step it down on stutter.

const TIERS = {
  high: {
    label: 'High',
    pixelRatio: 2,        // capped against devicePixelRatio
    shadowMapSize: 2048,
    gtao: true,
    bloom: true,
    smaa: true,
    hdriBackground: 'full',   // crisp photographic sky
    anisotropy: 8
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1.25,
    shadowMapSize: 1024,
    gtao: false,              // GTAO is the single most expensive pass
    bloom: true,
    smaa: true,
    hdriBackground: 'full',
    anisotropy: 4
  },
  low: {
    label: 'Low',
    pixelRatio: 1,
    shadowMapSize: 512,
    gtao: false,
    bloom: false,
    smaa: false,              // rely on the renderer's MSAA instead
    hdriBackground: 'blur',   // cheaper, hides low-res sky shimmer
    anisotropy: 2
  }
};

const ORDER = ['low', 'medium', 'high'];
const STORE_KEY = 'mathHeroes.quality'; // 'auto' | 'low' | 'medium' | 'high'

// Heuristic device assessment. Conservative on purpose — better to start smooth
// and let capable machines be bumped up manually than to freeze a laptop.
export function detectTier() {
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4; // GB (undefined on Safari → 4)

  // Try to read the GPU string (often masked, but useful when present).
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toString();
  } catch { /* ignore */ }
  const g = gpu.toLowerCase();

  if (mobile) return 'low';
  // Known weaker integrated GPUs.
  if (/(intel).*(hd|uhd|iris)/.test(g)) return 'low';
  // Apple Silicon / discrete GPUs handle the full look well.
  if (/apple m\d|radeon|geforce|rtx|nvidia/.test(g)) return cores >= 8 ? 'high' : 'medium';

  // Fall back to CPU/RAM signals.
  if (cores >= 8 && mem >= 8) return 'high';
  if (cores >= 4 && mem >= 4) return 'medium';
  return 'low';
}

export function getSettings(tierName) {
  return TIERS[tierName] || TIERS.medium;
}

export function tierList() {
  return ORDER.map(name => ({ name, label: TIERS[name].label }));
}

// Next lower tier name, or null if already at the bottom (used by the watchdog).
export function lowerTier(tierName) {
  const i = ORDER.indexOf(tierName);
  return i > 0 ? ORDER[i - 1] : null;
}

// Persisted preference: 'auto' (default) or a specific tier.
export function loadPreference() {
  try { return localStorage.getItem(STORE_KEY) || 'auto'; } catch { return 'auto'; }
}
export function savePreference(pref) {
  try { localStorage.setItem(STORE_KEY, pref); } catch { /* ignore */ }
}

// Resolve a preference to a concrete tier name.
export function resolveTier(pref) {
  return pref === 'auto' || !pref ? detectTier() : pref;
}
