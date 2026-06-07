// Heroes are real, rigged, animated 3-D characters (the Three.js "RobotExpressive"
// model, loaded from CDN). Each hero is tinted to its color, animates between
// Idle / Walking / Jump driven by movement, and carries cosmetics (cape, hat,
// trail). Used for both the local player and remote players.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { HEROES, WORLD } from '/shared/config.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
const HERO_COLORS = Object.fromEntries(HEROES.map(h => [h.id, h.color]));

let modelPromise = null;

// Load the rigged model once; everyone clones from it.
export function preloadHeroModel() {
  if (!modelPromise) {
    const loader = new GLTFLoader();
    modelPromise = loader.loadAsync(MODEL_URL).then(gltf => {
      gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return gltf;
    });
  }
  return modelPromise;
}

// Create a hero rig. Async because it waits for the (cached) model.
export async function createHero(heroId, cosmetics = {}, name = '') {
  const gltf = await preloadHeroModel();
  const model = cloneSkinned(gltf.scene);

  // Per-instance materials so tinting one hero doesn't affect others. Also
  // tuned so each hero reads as a glossy, physically-lit superhero suit under
  // the real HDRI environment — stronger reflections, a touch of metalness,
  // tighter highlights — instead of the flat default plastic look.
  model.traverse(o => {
    if (o.isMesh) {
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        if (!m || !m.isMeshStandardMaterial) return;
        m.envMapIntensity = 1.6;             // catch the HDRI sky/sun reflections
        if (m.name === 'Main') {             // the suit: sleek and slightly metallic
          m.metalness = Math.max(m.metalness, 0.35);
          m.roughness = THREE.MathUtils.clamp(m.roughness * 0.75, 0.18, 0.6);
        }
      });
      o.castShadow = true; o.receiveShadow = true;
    }
  });

  // Normalize size so the hero is ~2.2 units tall with feet on the ground.
  const box = new THREE.Box3().setFromObject(model);
  const h = (box.max.y - box.min.y) || 1;
  const scale = 2.2 / h;
  model.scale.setScalar(scale);
  model.position.y = -box.min.y * scale;
  model.rotation.y = Math.PI; // face +Z (direction of forward movement)

  const group = new THREE.Group();
  group.add(model);

  const hero = new Hero(group, model, gltf.animations, heroId);
  hero.setCosmetics(cosmetics, heroId);
  if (name) hero.addLabel(name);
  return hero;
}

export class Hero {
  constructor(group, model, animations, heroId) {
    this.group = group;      // add THIS to the scene; carries position/rotation
    this.model = model;
    this.heroId = heroId;
    this.cosmetics = {};
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.play('Idle', 0);
  }

  play(name, fade = 0.25) {
    const next = this.actions[name] || this.actions['Idle'];
    if (!next || this.current === next) return;
    if (this.current) this.current.fadeOut(fade);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current = next;
  }

  // Choose an animation from movement state.
  setMotion(moving, onGround, fast = false) {
    if (!onGround && this.actions['Jump']) this.play('Jump', 0.12);
    else if (moving) this.play(fast && this.actions['Running'] ? 'Running' : 'Walking', 0.2);
    else this.play('Idle', 0.3);
  }

  applyColor(color) {
    const c = new THREE.Color(color);
    this.model.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.name === 'Main') m.color.copy(c); });
      }
    });
  }

  setCosmetics(cosmetics = {}, heroId = this.heroId) {
    this.cosmetics = { ...cosmetics };
    this.applyColor(cosmetics.color || HERO_COLORS[heroId] || '#ff5d5d');
    this._cape(cosmetics.cape);
    this._hat(cosmetics.hat);
    this.trail = cosmetics.trail || null;
  }

  _cape(cape) {
    const old = this.group.getObjectByName('cape');
    if (old) this.group.remove(old);
    if (!cape) return;
    const color = cape === 'rainbow' ? 0xff5d5d : new THREE.Color(cape).getHex();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.5, 4, 6),
      new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.7 })
    );
    mesh.name = 'cape';
    mesh.position.set(0, 1.35, -0.42);
    mesh.castShadow = true;
    if (cape === 'rainbow') mesh.userData.rainbow = true;
    this.group.add(mesh);
  }

  _hat(hat) {
    const old = this.group.getObjectByName('hat');
    if (old) this.group.remove(old);
    if (!hat) return;
    let mesh;
    if (hat === 'crown') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.32, 10),
        new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.2 }));
      mesh.position.y = 2.35;
    } else if (hat === 'wizard') {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 14),
        new THREE.MeshStandardMaterial({ color: 0x5b3aa6, roughness: 0.6 }));
      mesh.position.y = 2.7;
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xe23b3b, roughness: 0.7 }));
      mesh.position.y = 2.15;
    }
    mesh.name = 'hat';
    mesh.castShadow = true;
    this.group.add(mesh);
  }

  addLabel(text) {
    const old = this.group.getObjectByName('label');
    if (old) this.group.remove(old);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 34px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, 8, 8, 240, 48, 14); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.name = 'label';
    sprite.scale.set(2.2, 0.55, 1);
    sprite.position.y = 2.95;
    this.group.add(sprite);
  }

  update(dt, time) {
    this.mixer.update(dt);
    const cape = this.group.getObjectByName('cape');
    if (cape) {
      cape.rotation.x = 0.18 + Math.sin((time || 0) * 6) * 0.12;
      if (cape.userData.rainbow) {
        cape.material.color.setHSL(((time || 0) * 0.2) % 1, 0.85, 0.6);
      }
    }
  }

  dispose() {
    this.group.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => m?.dispose?.());
      }
      if (o.isSprite) { o.material.map?.dispose?.(); o.material.dispose(); }
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// The locally-controlled player: physics + input + animation.
export class LocalPlayer {
  constructor(hero) {
    this.hero = hero;
    this.mesh = hero.group;     // main.js positions/rotates this
    this.vel = new THREE.Vector3();
    this.onGround = true;
    this.keys = {};
    this.touchDir = { x: 0, y: 0 };
    this.touchJump = false;
    this.time = 0;
  }

  bindInput() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  update(dt, camera, onJump, getGroundY) {
    this.time += dt;
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k['KeyW'] || k['ArrowUp']) mz -= 1;
    if (k['KeyS'] || k['ArrowDown']) mz += 1;
    if (k['KeyA'] || k['ArrowLeft']) mx -= 1;
    if (k['KeyD'] || k['ArrowRight']) mx += 1;
    mx += this.touchDir.x; mz += this.touchDir.y;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const yaw = Math.atan2(camDir.x, camDir.z);
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    let wx = mx * cos - mz * sin;
    let wz = mx * sin + mz * cos;
    const len = Math.hypot(wx, wz);
    let moving = false;
    if (len > 0.01) {
      wx /= len; wz /= len; moving = true;
      this.mesh.position.x += wx * WORLD.moveSpeed * dt;
      this.mesh.position.z += wz * WORLD.moveSpeed * dt;
      this.mesh.rotation.y = Math.atan2(wx, wz);
    }

    const jumpPressed = k['Space'] || this.touchJump;
    if (jumpPressed && this.onGround) {
      this.vel.y = WORLD.jumpVelocity;
      this.onGround = false;
      onJump && onJump();
    }
    this.touchJump = false;

    // Keep inside the arena, then settle on the terrain.
    const dist = Math.hypot(this.mesh.position.x, this.mesh.position.z);
    if (dist > WORLD.size) {
      this.mesh.position.x *= WORLD.size / dist;
      this.mesh.position.z *= WORLD.size / dist;
    }
    const groundY = getGroundY ? getGroundY(this.mesh.position.x, this.mesh.position.z) : 0;
    this.vel.y -= WORLD.gravity * dt;
    this.mesh.position.y += this.vel.y * dt;
    if (this.mesh.position.y <= groundY) { this.mesh.position.y = groundY; this.vel.y = 0; this.onGround = true; }

    this.hero.setMotion(moving, this.onGround);
    this.hero.update(dt, this.time);
    return moving;
  }
}

// Smoothly-interpolated remote players, animated from their movement speed.
export class RemotePlayer {
  constructor(hero) {
    this.hero = hero;
    this.mesh = hero.group;
    this.target = hero.group.position.clone();
    this.targetRy = 0;
    this.time = 0;
    this.lastDist = 0;
  }
  setTarget(pos) {
    this.target.set(pos.x, pos.y, pos.z);
    this.targetRy = pos.ry || 0;
  }
  update(dt) {
    this.time += dt;
    const before = this.mesh.position.clone();
    this.mesh.position.lerp(this.target, Math.min(1, dt * 10));
    const moved = this.mesh.position.distanceTo(before);
    const onGround = Math.abs(this.mesh.position.y - this.target.y) < 0.3;
    this.hero.setMotion(moved > 0.02 * (dt * 60), onGround);

    let diff = this.targetRy - this.mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.mesh.rotation.y += diff * Math.min(1, dt * 10);
    this.hero.update(dt, this.time);
  }
}
