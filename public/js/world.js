// Builds and manages the 3-D scene with a focus on realism:
//  • noise-displaced rolling terrain (flat near spawn, hilly toward the edges)
//  • procedural PBR ground textures (albedo + normal) per biome
//  • a physical sky with atmospheric scattering + image-based lighting (IBL)
//  • reflective water for the swamp and ice realms
//  • dense, instanced vegetation (trees, rocks, cacti, grass, ice spires)
//  • soft shadows, ACES tone mapping and bloom post-processing
// Everything is procedural — still no external model/texture files.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { STAGES, WORLD, makeRng, seedFor } from '/shared/config.js';
import { makeNoise2D } from './noise.js';
import { groundTextures, barkTexture } from './textures.js';
import { loadHDRI, loadGroundPBR } from './assets.js';

// Per-biome sky / lighting / water mood.
const BIOME_ENV = {
  desert: { elevation: 18, azimuth: 165, turbidity: 14, rayleigh: 1.2, sun: 0xfff0d0, fog: 0xe7c98f, fogFar: 180, water: null },
  swamp:  { elevation: 9,  azimuth: 200, turbidity: 8,  rayleigh: 3.0, sun: 0xcfe0b0, fog: 0x7d8f6a, fogFar: 120, water: { level: -0.6, color: 0x33402b, opacity: 0.82, rough: 0.25 } },
  rocky:  { elevation: 22, azimuth: 120, turbidity: 6,  rayleigh: 2.0, sun: 0xeaf0ff, fog: 0xaeb6c2, fogFar: 150, water: null },
  forest: { elevation: 30, azimuth: 150, turbidity: 4,  rayleigh: 1.5, sun: 0xfff4e0, fog: 0xbfe0c8, fogFar: 150, water: null },
  ice:    { elevation: 14, azimuth: 190, turbidity: 3,  rayleigh: 2.5, sun: 0xeaf6ff, fog: 0xdfeef9, fogFar: 170, water: { level: -0.4, color: 0xbfe0f0, opacity: 0.55, rough: 0.04 } }
};

// Real, CC0 photoreal assets per biome (HDRI environment + PBR ground set).
// Loaded from Poly Haven's CDN by assets.js; falls back to the procedural look
// if a download fails. `bg` dims the (bright) HDR sky so geometry reads well;
// `envI` scales how strongly the environment lights/reflects on surfaces.
const BIOME_ASSETS = {
  desert: { hdri: 'qwantani_noon',        ground: 'sand_01',            repeat: 48, bg: 0.95, envI: 1.0 },
  swamp:  { hdri: 'mossy_forest',         ground: 'brown_mud_leaves_01', repeat: 40, bg: 0.85, envI: 0.9 },
  rocky:  { hdri: 'rocky_ridge_puresky',  ground: 'rocky_terrain_02',   repeat: 36, bg: 1.0,  envI: 1.0 },
  forest: { hdri: 'forest_slope',         ground: 'forrest_ground_01',  repeat: 44, bg: 0.9,  envI: 0.95 },
  ice:    { hdri: 'snowy_hillside',       ground: 'snow_02',            repeat: 40, bg: 1.0,  envI: 1.1 }
};

export class World {
  constructor(renderer, quality = {}) {
    this.renderer = renderer;
    this.q = quality;            // active quality-tier settings (see quality.js)
    this.scene = new THREE.Scene();
    this.orbMeshes = new Map();
    this.decor = [];
    this._particles = [];
    this.time = 0;
    this.waterLevel = -Infinity;
    this.waterMat = null;

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);

    // Lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 0.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    const shadowSize = this.q.shadowMapSize || 2048;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0004;
    const d = 90;
    Object.assign(this.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 400 });
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Sky + IBL
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.ground = null;
    this.trophyMesh = null;

    this._setupComposer();
  }

  _setupComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Ground-truth ambient occlusion (GTAO): adds the soft contact shadows that
    // sell realism — but it's the most expensive pass, so it's enabled only on
    // the High tier. Guarded so a driver hiccup can't break the whole pipeline.
    try {
      const gtao = new GTAOPass(this.scene, this.camera, w, h);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.updateGtaoMaterial({ radius: 3.0, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16, screenSpaceRadius: false });
      gtao.blendIntensity = 0.9;
      gtao.enabled = this.q.gtao !== false;
      this.gtao = gtao;
      this.composer.addPass(gtao);
    } catch (e) { console.warn('GTAO unavailable, continuing without it', e); }

    // Subtle bloom: only the brightest things (orbs, sun glints) glow.
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.4, 0.9);
    bloom.enabled = this.q.bloom !== false;
    this.bloom = bloom;
    this.composer.addPass(bloom);
    const smaa = new SMAAPass(w, h);
    smaa.enabled = this.q.smaa !== false;
    this.smaa = smaa;
    this.composer.addPass(smaa);
    this.composer.addPass(new OutputPass());
  }

  // Re-tune the live pipeline to a new quality-tier settings object without
  // rebuilding the scene. Pixel ratio is handled by the caller on the renderer.
  setQuality(q) {
    this.q = q;
    if (this.gtao) this.gtao.enabled = q.gtao !== false;
    if (this.bloom) this.bloom.enabled = q.bloom !== false;
    if (this.smaa) this.smaa.enabled = q.smaa !== false;
    // Resize the shadow map live.
    const size = q.shadowMapSize || 1024;
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    // Sky crispness.
    if (this.scene.background && this.scene.background.isTexture) {
      this.scene.backgroundBlurriness = q.hdriBackground === 'blur' ? 0.35 : 0.0;
    }
  }

  // ---- Terrain height field (shared by mesh + gameplay) ----
  terrainHeight(x, z) {
    if (!this.noise) return 0;
    const d = Math.hypot(x, z) / WORLD.size;            // 0 at center
    const amp = THREE.MathUtils.clamp((d - 0.12) / 0.5, 0, 1); // flat near spawn
    const base = this.noise.fbm(x * 0.012, z * 0.012, 4) * 3.6;
    const detail = this.noise.fbm(x * 0.05, z * 0.05, 3) * 0.7;
    return (base + detail) * amp;
  }

  // Async: streams the real HDRI sky + PBR ground for the biome, then applies
  // them. Resolves once the photoreal assets are in place (or the procedural
  // fallback is up). Callers await it and show a "loading realm" veil meanwhile.
  async buildStage(stageIndex, roomCode, adventure) {
    const stage = STAGES[stageIndex];
    const env = BIOME_ENV[stage.biome] || BIOME_ENV.desert;
    const assets = BIOME_ASSETS[stage.biome] || BIOME_ASSETS.desert;
    this.noise = makeNoise2D(seedFor(roomCode + 'terrain', stageIndex, adventure) || 1);

    this.scene.fog = new THREE.Fog(new THREE.Color(env.fog), Math.min(55, env.fogFar * 0.35), env.fogFar);
    this.hemi.color.set(env.fog);
    this.hemi.groundColor.set(stage.colors.ground);
    this.hemi.intensity = 0.28;

    this._positionSun(env);
    this._buildTerrain(stage, assets);
    this._clearScenery();
    this._buildWater(env);

    const rng = makeRng(seedFor(roomCode + 'decor', stageIndex, adventure));
    this._decorate(stage.biome, rng);

    // Heavy assets stream in parallel; each upgrades the scene when ready and
    // fails soft to the procedural look.
    await Promise.all([
      this._applyEnvironment(env, assets),
      this._applyGroundPBR(assets)
    ]);

    return stage;
  }

  // Sun light direction/colour/intensity — independent of which sky we end up
  // using, so shadows are correct even while the HDRI is still downloading.
  _positionSun(env) {
    const phi = THREE.MathUtils.degToRad(90 - env.elevation);
    const theta = THREE.MathUtils.degToRad(env.azimuth);
    const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sunDir = sunPos.clone().normalize();
    this.sun.position.copy(sunPos).multiplyScalar(150);
    this.sun.color.set(env.sun);
    this.sun.intensity = Math.max(1.4, 2.6 * Math.sin(THREE.MathUtils.degToRad(env.elevation)) + 0.8);
  }

  // Photoreal path: real HDRI as both the visible sky and the image-based
  // lighting source. Falls back to the procedural physical Sky on failure.
  async _applyEnvironment(env, assets) {
    let hdri = null;
    try { hdri = await loadHDRI(assets.hdri); } catch (e) { console.warn('HDRI load failed, using procedural sky', e); }

    if (this._envRT) { this._envRT.dispose(); this._envRT = null; }
    if (hdri) {
      this._envRT = this.pmrem.fromEquirectangular(hdri);
      this.scene.environment = this._envRT.texture;
      this.scene.background = hdri;
      this.scene.backgroundIntensity = assets.bg ?? 1.0;  // tame the bright HDR sky
      this.scene.backgroundBlurriness = this.q.hdriBackground === 'blur' ? 0.35 : 0.0;
      this.sky.visible = false;
      if (this.ground) this.ground.material.envMapIntensity = assets.envI ?? 1.0;
    } else {
      this.scene.background = null;
      this.sky.visible = true;
      this._setSky(env);
    }
  }

  // Procedural physical-sky fallback (used only if the HDRI download fails).
  // The sun light itself is already placed by _positionSun.
  _setSky(env) {
    const u = this.sky.material.uniforms;
    u.turbidity.value = env.turbidity;
    u.rayleigh.value = env.rayleigh;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy((this.sunDir || new THREE.Vector3(0, 1, 0)));

    // Regenerate image-based lighting from the current sky.
    if (this._envRT) this._envRT.dispose();
    this._envRT = this.pmrem.fromScene(this.sky);
    this.scene.environment = this._envRT.texture;
  }

  _buildTerrain(stage, assets) {
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); this.ground.material.dispose(); }
    const span = (WORLD.size + 30) * 2;
    const segs = 140;
    const geo = new THREE.PlaneGeometry(span, span, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.terrainHeight(x, z));
    }
    geo.computeVertexNormals();

    // Start with the lightweight procedural texture so the realm is visible
    // instantly; _applyGroundPBR swaps in the photoreal maps when they arrive.
    const { map, normalMap } = groundTextures(stage.biome, 30);
    const mat = new THREE.MeshStandardMaterial({
      map, normalMap, roughness: 0.96, metalness: 0.0,
      normalScale: new THREE.Vector2(0.8, 0.8),
      envMapIntensity: (assets && assets.envI) || 1.0
    });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  // Swap the terrain over to real photoreal PBR maps once downloaded. The `arm`
  // texture drives AO/roughness/metalness from its R/G/B channels, so one image
  // powers three maps. No displacementMap — gameplay physics read terrainHeight,
  // so the visible surface must match the collision surface exactly.
  async _applyGroundPBR(assets) {
    const ground = this.ground;
    let set = null;
    try { set = await loadGroundPBR(assets.ground, assets.repeat || 40, this.q.anisotropy || 8); }
    catch (e) { console.warn('PBR ground load failed, keeping procedural texture', e); return; }
    if (!ground || ground !== this.ground) return; // stage changed mid-load

    const mat = ground.material;
    mat.map = set.map;
    mat.normalMap = set.normalMap;
    mat.aoMap = set.armMap;
    mat.roughnessMap = set.armMap;
    mat.metalnessMap = set.armMap;
    mat.color.set(0xffffff);
    mat.roughness = 1.0;     // modulated by arm.g
    mat.metalness = 1.0;     // modulated by arm.b (~0 for ground → stays matte)
    mat.aoMapIntensity = 1.0;
    mat.normalScale.set(1.0, 1.0);
    mat.envMapIntensity = assets.envI || 1.0;
    mat.needsUpdate = true;
  }

  _waterNormals() {
    if (!this._wn) {
      this._wn = new THREE.TextureLoader().load(
        'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/waternormals.jpg');
      this._wn.wrapS = this._wn.wrapT = THREE.RepeatWrapping;
    }
    return this._wn;
  }

  _buildWater(env) {
    if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); this.water.material.dispose(); this.water = null; }
    this.waterLevel = -Infinity;
    if (!env.water) return;
    const span = (WORLD.size + 30) * 2;
    const geo = new THREE.PlaneGeometry(span, span);
    // Real reflective water: mirrors the sky & scenery, with animated ripples
    // and a sun glint — far more convincing than a flat transparent plane.
    const water = new Water(geo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: this._waterNormals(),
      sunDirection: (this.sunDir || new THREE.Vector3(0, 1, 0)).clone(),
      sunColor: 0xffffff,
      waterColor: env.water.color,
      distortionScale: env.water.rough < 0.1 ? 1.2 : 3.0, // calmer for ice
      fog: !!this.scene.fog
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = env.water.level;
    this.scene.add(water);
    this.water = water;
    this.waterLevel = env.water.level;
  }

  // ---- Instancing helper ----
  _instanced(geo, mat, placements, castShadow = true) {
    const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    placements.forEach((pl, i) => {
      p.set(pl.x, pl.y, pl.z);
      q.setFromEuler(new THREE.Euler(0, pl.ry || 0, 0));
      s.set(pl.s || 1, pl.sy || pl.s || 1, pl.s || 1);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.decor.push(mesh);
    return mesh;
  }

  _scatter(count, rng, { minR = 8, avoidWater = true } = {}) {
    const span = WORLD.size;
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 6) {
      const x = (rng() * 2 - 1) * span;
      const z = (rng() * 2 - 1) * span;
      if (Math.hypot(x, z) < minR) continue;
      const y = this.terrainHeight(x, z);
      if (avoidWater && y < this.waterLevel + 0.2) continue;
      out.push({ x, y, z, ry: rng() * Math.PI * 2, s: 0.7 + rng() * 0.7 });
    }
    return out;
  }

  _decorate(biome, rng) {
    if (biome === 'desert') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3f7d3f, roughness: 0.85 });
      this._instanced(this._cactusGeometry(), mat, this._scatter(45, rng, { avoidWater: false }));
      // rocks
      this._instanced(new THREE.DodecahedronGeometry(1, 0),
        new THREE.MeshStandardMaterial({ color: 0xb08b55, roughness: 1, flatShading: true }),
        this._scatter(40, rng, { avoidWater: false }));
    } else if (biome === 'swamp') {
      this._trees(rng, 60, 0x3c6b34, 0x274d22, 1.0);
      this._grass(rng, 300, 0x4a6b34);
      this._instanced(new THREE.DodecahedronGeometry(0.9, 0),
        new THREE.MeshStandardMaterial({ color: 0x556b4a, roughness: 1, flatShading: true }),
        this._scatter(40, rng));
    } else if (biome === 'rocky') {
      const rockGeo = new THREE.DodecahedronGeometry(1.6, 0);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8d96, roughness: 1, flatShading: true, metalness: 0.05 });
      const big = this._scatter(70, rng, { avoidWater: false });
      big.forEach(p => { p.s *= 1.4; p.sy = p.s * (0.7 + Math.random()); });
      this._instanced(rockGeo, rockMat, big);
      this._instanced(new THREE.ConeGeometry(1.2, 4, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.9, flatShading: true }),
        this._scatter(30, rng, { avoidWater: false }));
    } else if (biome === 'forest') {
      this._trees(rng, 80, 0x2f8f3a, 0x5a3a22, 1.9);
      this._grass(rng, 380, 0x3f8f44);
      this._instanced(new THREE.DodecahedronGeometry(1, 0),
        new THREE.MeshStandardMaterial({ color: 0x6b7a52, roughness: 1, flatShading: true }),
        this._scatter(30, rng));
    } else if (biome === 'ice') {
      const spire = new THREE.ConeGeometry(0.8, 4.5, 6).translate(0, 2.25, 0);
      const iceMat = new THREE.MeshStandardMaterial({ color: 0xcfeeff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 });
      const sp = this._scatter(55, rng, { avoidWater: false });
      sp.forEach(p => { p.sy = p.s * (1 + Math.random() * 1.5); });
      this._instanced(spire, iceMat, sp);
      // snowy rocks
      this._instanced(new THREE.DodecahedronGeometry(1.1, 0),
        new THREE.MeshStandardMaterial({ color: 0xeaf2fa, roughness: 0.8, flatShading: true }),
        this._scatter(35, rng, { avoidWater: false }));
    }
  }

  // A saguaro-style cactus (body + two arms) merged into one geometry so it
  // can be instanced cheaply hundreds of times.
  _cactusGeometry() {
    const parts = [];
    parts.push(new THREE.CylinderGeometry(0.45, 0.62, 3.4, 10).translate(0, 1.7, 0));
    const rh = new THREE.CylinderGeometry(0.17, 0.17, 0.75, 8); rh.rotateZ(Math.PI / 2); rh.translate(0.5, 1.95, 0); parts.push(rh);
    parts.push(new THREE.CylinderGeometry(0.19, 0.19, 1.15, 8).translate(0.82, 2.45, 0));
    const lh = new THREE.CylinderGeometry(0.15, 0.15, 0.62, 8); lh.rotateZ(Math.PI / 2); lh.translate(-0.44, 1.55, 0); parts.push(lh);
    parts.push(new THREE.CylinderGeometry(0.17, 0.17, 0.95, 8).translate(-0.72, 1.98, 0));
    return mergeGeometries(parts);
  }

  _trees(rng, count, leafColor, trunkColor, scale) {
    const place = this._scatter(count, rng).map(p => ({ ...p, s: (0.8 + rng() * 0.6) * scale }));
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3, 7).translate(0, 1.5, 0);
    const bark = barkTexture();
    const trunkMat = new THREE.MeshStandardMaterial({ map: bark, color: trunkColor, roughness: 0.9 });
    this._instanced(trunkGeo, trunkMat, place);
    const leafGeo = new THREE.IcosahedronGeometry(1.5, 0).translate(0, 3.6, 0);
    const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 1, flatShading: true });
    this._instanced(leafGeo, leafMat, place);
  }

  _grass(rng, count, color) {
    const blade = new THREE.ConeGeometry(0.12, 0.9, 4).translate(0, 0.45, 0);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
    const place = this._scatter(count, rng, { minR: 6 }).map(p => ({ ...p, s: 0.6 + rng() * 0.9 }));
    this._instanced(blade, mat, place, false);
  }

  _clearScenery() {
    this.decor.forEach(m => {
      this.scene.remove(m);
      m.geometry?.dispose?.();
      if (Array.isArray(m.material)) m.material.forEach(x => x.dispose()); else m.material?.dispose?.();
    });
    this.decor.length = 0;
    this.orbMeshes.forEach(m => this.scene.remove(m));
    this.orbMeshes.clear();
    if (this.trophyMesh) { this.scene.remove(this.trophyMesh); this.trophyMesh = null; }
  }

  // ---- Orbs ----
  setOrbs(orbs) {
    for (const [id, m] of this.orbMeshes) {
      if (!orbs.find(o => o.id === id)) { this.scene.remove(m); this.orbMeshes.delete(id); }
    }
    orbs.forEach(o => {
      if (o.collected) { this.removeOrb(o.id); return; }
      if (this.orbMeshes.has(o.id)) return;
      this.addOrb(o);
    });
  }

  addOrb(o) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.85, 0),
      new THREE.MeshStandardMaterial({ color: 0xfff1a8, emissive: 0xffc23a, emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.2 })
    );
    g.add(core);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.4, 0.07, 10, 28),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8fd3ff, emissiveIntensity: 1.6 })
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.add(new THREE.PointLight(0xffd27a, 3, 14, 2));
    const base = this.terrainHeight(o.x, o.z) + 2.2;
    g.position.set(o.x, base, o.z);
    g.userData = { orbId: o.id, base };
    this.scene.add(g);
    this.orbMeshes.set(o.id, g);
  }

  removeOrb(id) {
    const m = this.orbMeshes.get(id);
    if (m) {
      this.scene.remove(m);
      m.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      this.orbMeshes.delete(id);
    }
  }

  popAt(pos) {
    const group = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe089 }));
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      p.userData.v = new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp);
      group.add(p);
    }
    group.position.copy(pos);
    group.userData.life = 0;
    this.scene.add(group);
    this._particles.push(group);
  }

  showTrophy() {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1, roughness: 0.18, emissive: 0x554400, emissiveIntensity: 0.5 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.6, 1.6, 16), gold); cup.position.y = 3; cup.castShadow = true; g.add(cup);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 10), gold); stem.position.y = 1.7; g.add(stem);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3, metalness: 0.4 })); base.position.y = 1; g.add(base);
    g.add(new THREE.PointLight(0xffd700, 3, 22, 2));
    const tx = 0, tz = -WORLD.size + 12;
    g.position.set(tx, this.terrainHeight(tx, tz) + 0.5, tz);
    g.userData = { trophy: true };
    this.scene.add(g);
    this.trophyMesh = g;
    return g;
  }

  update(dt) {
    this.time += dt;
    for (const m of this.orbMeshes.values()) {
      m.rotation.y += dt * 1.5;
      if (m.children[1]) m.children[1].rotation.z += dt * 2;
      m.position.y = m.userData.base + Math.sin(this.time * 2 + m.position.x) * 0.3;
    }
    if (this.trophyMesh) this.trophyMesh.rotation.y += dt * 0.8;
    if (this.water) this.water.material.uniforms['time'].value += dt;
    if (this._particles.length) {
      this._particles = this._particles.filter(group => {
        group.userData.life += dt;
        group.children.forEach(p => {
          p.userData.v.y -= 9 * dt;
          p.position.addScaledVector(p.userData.v, dt);
          p.material.transparent = true;
          p.material.opacity = Math.max(0, 1 - group.userData.life);
        });
        if (group.userData.life > 1) {
          this.scene.remove(group);
          group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
          return false;
        }
        return true;
      });
    }
  }

  render() {
    this.composer.render();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
}
