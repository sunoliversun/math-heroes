// Photoreal asset loader — streams real HDRI environment maps and full PBR
// ground texture sets (albedo + normal + packed AO/Rough/Metal) from Poly Haven's
// CDN (CC0, served with `access-control-allow-origin: *`, so browser-loadable).
//
// Everything is cached by URL/name and loaded once, then reused as players move
// between realms and adventures. Loads are non-blocking and fail soft: if an
// asset can't be fetched the caller falls back to the procedural look.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const PH = 'https://dl.polyhaven.org/file/ph-assets';
const HDRI_BASE = `${PH}/HDRIs/hdr/1k`;
const TEX_BASE = `${PH}/Textures/jpg/1k`;

const _rgbe = new RGBELoader();
const _tex = new THREE.TextureLoader();
_rgbe.setCrossOrigin('anonymous');
_tex.setCrossOrigin('anonymous');

const hdriCache = new Map();   // name -> Promise<EquirectTexture>
const groundCache = new Map(); // key  -> Promise<{ map, normalMap, armMap }>

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    _tex.load(url, resolve, undefined, () => reject(new Error(`tex ${url}`)));
  });
}

// Equirectangular HDR environment. Returned texture is tagged for both
// background display and (via PMREM in world.js) image-based lighting.
export function loadHDRI(name) {
  if (hdriCache.has(name)) return hdriCache.get(name);
  const url = `${HDRI_BASE}/${name}_1k.hdr`;
  const p = new Promise((resolve, reject) => {
    _rgbe.load(url, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      resolve(tex);
    }, undefined, () => reject(new Error(`hdri ${url}`)));
  });
  hdriCache.set(name, p);
  return p;
}

// Full PBR ground set. `arm` packs AO(r) / Roughness(g) / Metalness(b) in one
// texture — three.js reads the matching channel for aoMap/roughnessMap/
// metalnessMap, so one download powers all three.
export function loadGroundPBR(name, repeat = 40, aniso = 8) {
  const key = `${name}@${repeat}`;
  if (groundCache.has(key)) return groundCache.get(key);
  const p = Promise.all([
    loadTexture(`${TEX_BASE}/${name}/${name}_diff_1k.jpg`),
    loadTexture(`${TEX_BASE}/${name}/${name}_nor_gl_1k.jpg`),
    loadTexture(`${TEX_BASE}/${name}/${name}_arm_1k.jpg`),
  ]).then(([map, normalMap, armMap]) => {
    map.colorSpace = THREE.SRGBColorSpace;
    normalMap.colorSpace = THREE.NoColorSpace;
    armMap.colorSpace = THREE.NoColorSpace;
    for (const t of [map, normalMap, armMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = aniso;
    }
    return { map, normalMap, armMap };
  });
  groundCache.set(key, p);
  return p;
}
