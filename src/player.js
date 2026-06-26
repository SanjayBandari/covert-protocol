// First-person controller: pointer-lock look, movement with collision,
// two weapons (suppressed pistol / assault rifle), shooting and damage.

import * as THREE from 'three';
import { collideAndSlide } from './world.js';

const GRAVITY = 14;
const _ray = new THREE.Raycaster();

function buildViewmodel(kind) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.45, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x33291e, roughness: 0.9 });

  const mk = (w, h, d, x, y, z, mat = metal) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  if (kind === 'pistol') {
    mk(0.045, 0.06, 0.24, 0, 0.015, -0.1);          // slide
    mk(0.04, 0.09, 0.05, 0, -0.05, 0.02, grip);     // grip
    mk(0.035, 0.035, 0.16, 0, 0.015, -0.30);        // suppressor
  } else {
    mk(0.05, 0.07, 0.5, 0, 0, -0.18);               // receiver+barrel
    mk(0.04, 0.1, 0.05, 0, -0.07, 0.0, grip);       // grip
    mk(0.045, 0.12, 0.06, 0, -0.08, -0.12, metal);  // mag
    mk(0.05, 0.06, 0.14, 0, 0.0, 0.12, grip);       // stock
    mk(0.02, 0.03, 0.05, 0, 0.05, -0.25);           // front sight
  }
  return g;
}

export class Player {
  constructor(camera, world, audio) {
    this.camera = camera;
    this.world = world;
    this.audio = audio;

    this.pos = world.spawnPos.clone();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.crouched = false;
    this.health = 100;
    this.lastDamageT = -99;
    this.dead = false;

    this.yawObject = camera; // rotation handled directly on camera (YXZ order)
    camera.rotation.order = 'YXZ';
    camera.rotation.set(0, 0, 0); // facing -Z = toward the base

    this.keys = {};
    this.triggerDown = false;
    this.bobT = 0;
    this.recoil = 0;

    this.weapons = [
      { name: 'SD PISTOL', dmg: 50, mag: 12, magSize: 12, reserve: 60, rof: 0.32, auto: false, noise: 9, spread: 0.011, suppressed: true },
      { name: 'AS RIFLE', dmg: 26, mag: 30, magSize: 30, reserve: 120, rof: 0.105, auto: true, noise: 70, spread: 0.02, suppressed: false },
    ];
    this.cur = 0;
    this.fireCd = 0;
    this.reloadT = 0;
    this.stepNoiseT = 0;

    this.viewmodels = [buildViewmodel('pistol'), buildViewmodel('rifle')];
    for (const vm of this.viewmodels) {
      vm.position.set(0.24, -0.2, -0.45);
      camera.add(vm);
    }
    this._showWeapon();

    // muzzle flash light
    this.flash = new THREE.PointLight(0xffc870, 0, 6, 2);
    this.flash.position.set(0.24, -0.12, -0.7);
    camera.add(this.flash);
    this.flashT = 0;

    // callbacks set by main
    this.onShoot = null;     // (suppressed) => {} — noise propagation
    this.onHit = null;       // (killed) => {} — hitmarker UI

    this._bindInput();
  }

  _bindInput() {
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyC') this.crouched = !this.crouched;
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'Digit1') this.switchWeapon(0);
      if (e.code === 'Digit2') this.switchWeapon(1);
      if (e.code === 'KeyQ') this.switchWeapon(1 - this.cur);
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    document.addEventListener('mousedown', e => { if (e.button === 0) this.triggerDown = true; });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.triggerDown = false; });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement) {
        this.camera.rotation.y -= e.movementX * 0.0021;
        this.camera.rotation.x -= e.movementY * 0.0021;
        this.camera.rotation.x = Math.max(-1.52, Math.min(1.52, this.camera.rotation.x));
      }
    });
  }

  eyeHeight() { return this.crouched ? 1.05 : 1.7; }
  weapon() { return this.weapons[this.cur]; }

  _showWeapon() {
    this.viewmodels.forEach((vm, i) => { vm.visible = i === this.cur; });
  }

  switchWeapon(i) {
    if (i === this.cur || this.reloadT > 0) return;
    this.cur = i;
    this.fireCd = 0.25;
    this._showWeapon();
    this.audio.beep();
  }

  startReload() {
    const w = this.weapon();
    if (this.reloadT > 0 || w.mag === w.magSize || w.reserve <= 0) return;
    this.reloadT = 1.5;
    this.audio.reload();
  }

  setTargets(guardManager) {
    this.guardManager = guardManager;
  }

  shoot() {
    const w = this.weapon();
    if (w.mag <= 0) {
      this.audio.dryFire();
      this.fireCd = 0.3;
      this.startReload();
      return;
    }
    w.mag--;
    this.fireCd = w.rof;
    this.recoil = Math.min(0.07, this.recoil + 0.028);
    this.flashT = 0.045;
    this.audio.shot(w.suppressed);
    if (this.onShoot) this.onShoot(w.suppressed ? w.noise : w.noise);

    // ray from screen center with spread
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    dir.x += (Math.random() - 0.5) * w.spread * 2;
    dir.y += (Math.random() - 0.5) * w.spread * 2;
    dir.z += (Math.random() - 0.5) * w.spread * 2;
    dir.normalize();
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    _ray.set(origin, dir);
    _ray.far = 200;

    const targets = [...this.world.losMeshes];
    for (const g of this.guardManager.aliveGuards()) targets.push(g.group);
    const hits = _ray.intersectObjects(targets, true);

    let end = origin.clone().addScaledVector(dir, 200);
    if (hits.length > 0) {
      const h = hits[0];
      end = h.point;
      let node = h.object, guard = null;
      while (node) {
        if (node.userData && node.userData.guardRef) { guard = node.userData.guardRef; break; }
        node = node.parent;
      }
      if (guard) {
        const isHead = h.point.y > guard.pos.y + 1.45;
        const killed = this.guardManager.damageGuard(guard, w.dmg, isHead);
        this.audio.hit(killed);
        if (this.onHit) this.onHit(killed);
      }
    }
    const muzzle = new THREE.Vector3(0.24, -0.12, -0.7).applyMatrix4(this.camera.matrixWorld);
    this.guardManager.spawnTracer(muzzle, end);
  }

  takeDamage(dmg) {
    if (this.dead) return;
    this.health -= dmg;
    this.lastDamageT = performance.now() / 1000;
    this.audio.hurt();
    // small camera kick
    this.camera.rotation.x += (Math.random() - 0.5) * 0.02;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }

  update(dt, time) {
    if (this.dead) return;

    // --- movement ---
    const sprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed = this.crouched ? 2.2 : sprint ? 6.6 : 4.2;

    const fwd = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const strafe = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);

    const yaw = this.camera.rotation.y;
    const wishX = (Math.sin(yaw) * -fwd) + (Math.cos(yaw) * strafe);
    const wishZ = (Math.cos(yaw) * -fwd) + (-Math.sin(yaw) * strafe);
    const len = Math.hypot(wishX, wishZ) || 1;

    const accel = this.onGround ? 12 : 3;
    this.vel.x += ((wishX / len) * speed - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += ((wishZ / len) * speed - this.vel.z) * Math.min(1, accel * dt);

    if (this.keys['Space'] && this.onGround) {
      this.vy = 4.6;
      this.onGround = false;
      this.crouched = false;
    }
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.onGround = true; }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collideAndSlide(this.pos, 0.5, this.world.colliders);

    // keep inside the playable area
    this.pos.x = Math.max(-115, Math.min(115, this.pos.x));
    this.pos.z = Math.max(-115, Math.min(115, this.pos.z));

    // sprint footsteps make noise
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1;
    if (sprint && moving && this.onGround) {
      this.stepNoiseT -= dt;
      if (this.stepNoiseT <= 0) {
        this.stepNoiseT = 0.45;
        if (this.onShoot) this.onShoot(13); // reuse noise channel
      }
    }

    // --- camera ---
    const targetEye = this.eyeHeight();
    this.camera.position.set(
      this.pos.x,
      this.pos.y + targetEye + Math.sin(this.bobT) * 0.035 * (moving ? 1 : 0),
      this.pos.z
    );
    if (moving && this.onGround) this.bobT += dt * (sprint ? 11 : 7);

    // --- weapons ---
    this.fireCd -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const w = this.weapon();
        const need = w.magSize - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
      }
    } else if (this.triggerDown && this.fireCd <= 0) {
      this.shoot();
      if (!this.weapon().auto) this.triggerDown = false;
    }

    // viewmodel recoil + sway
    this.recoil = Math.max(0, this.recoil - dt * 0.25);
    const vm = this.viewmodels[this.cur];
    vm.position.z = -0.45 + this.recoil * 1.6;
    vm.rotation.x = this.recoil * 2.2;
    vm.position.y = -0.2 + Math.sin(this.bobT * 0.5) * 0.006 * (moving ? 1 : 0)
      - (this.reloadT > 0 ? 0.12 : 0);

    // muzzle flash
    this.flashT -= dt;
    this.flash.intensity = this.flashT > 0 ? 14 : 0;

    // health regen after 6s without damage
    if (time - this.lastDamageT > 6 && this.health < 100) {
      this.health = Math.min(100, this.health + 5 * dt);
    }
  }
}
