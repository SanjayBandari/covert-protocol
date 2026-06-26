// Guard AI: patrol → suspicious → alert state machine, vision-cone + LOS
// detection, noise reactions, burst fire at the player, and death handling.

import * as THREE from 'three';
import { collideAndSlide } from './world.js';

export const G_STATE = { PATROL: 0, SUSP: 1, ALERT: 2, DEAD: 3 };

const EYE_H = 1.62;
const FOV_COS = Math.cos(THREE.MathUtils.degToRad(55)); // 110° cone
const VIEW_DIST = 45;
const VIEW_DIST_ALERT = 60;

const _ray = new THREE.Raycaster();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function buildSoldier() {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x3b4435, roughness: 0.95 });
  const clothDk = new THREE.MeshStandardMaterial({ color: 0x2e3529, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9c7b5e, roughness: 0.9 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.7, metalness: 0.3 });

  const mk = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  mk(new THREE.BoxGeometry(0.19, 0.78, 0.22), clothDk, -0.13, 0.39, 0);  // legs
  mk(new THREE.BoxGeometry(0.19, 0.78, 0.22), clothDk, 0.13, 0.39, 0);
  mk(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth, 0, 1.09, 0);         // torso
  mk(new THREE.BoxGeometry(0.56, 0.2, 0.34), gear, 0, 1.22, 0);          // vest
  mk(new THREE.BoxGeometry(0.16, 0.55, 0.18), cloth, -0.36, 1.05, 0.1);  // arms
  mk(new THREE.BoxGeometry(0.16, 0.55, 0.18), cloth, 0.36, 1.05, 0.1);
  mk(new THREE.SphereGeometry(0.155, 10, 10), skin, 0, 1.56, 0);         // head
  mk(new THREE.SphereGeometry(0.185, 10, 8), gear, 0, 1.63, 0).scale.y = 0.62; // helmet
  mk(new THREE.BoxGeometry(0.09, 0.12, 0.72), gear, 0.14, 1.18, 0.36);   // rifle

  return g;
}

class Guard {
  constructor(scene, def, world) {
    this.world = world;
    this.group = buildSoldier();
    this.group.traverse(o => { o.userData.guardRef = this; });
    scene.add(this.group);

    this.waypoints = def.waypoints;
    this.wpIndex = 0;
    const wp = this.waypoints[0];
    this.pos = new THREE.Vector3(wp.x, 0, wp.z);
    this.yaw = Math.random() * Math.PI * 2;
    this.targetYaw = this.yaw;

    this.state = G_STATE.PATROL;
    this.hp = 100;
    this.detection = 0;
    this.waitT = 0;
    this.suspPos = new THREE.Vector3();
    this.suspT = 0;
    this.lastKnown = new THREE.Vector3();
    this.searchT = 0;
    this.burstCd = 1 + Math.random();
    this.pendingShots = 0;
    this.shotTimer = 0;
    this.deathT = -1;
    this.canSee = false;
  }

  faceToward(x, z, dt, speed = 6) {
    this.targetYaw = Math.atan2(x - this.pos.x, z - this.pos.z);
    let diff = this.targetYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * speed);
  }

  moveToward(x, z, speed, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    const step = Math.min(speed * dt, d);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    collideAndSlide(this.pos, 0.45, this.world.colliders);
    this.faceToward(x, z, dt);
    return d;
  }

  checkVision(playerEye, playerCrouched, dt) {
    this.canSee = false;
    _v1.set(this.pos.x, EYE_H, this.pos.z);
    _v2.copy(playerEye).sub(_v1);
    const dist = _v2.length();
    const viewDist = this.state === G_STATE.ALERT ? VIEW_DIST_ALERT : VIEW_DIST;
    if (dist > viewDist) return { dist, vis: 0 };

    _v2.normalize();
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const dot = _v2.x * fwdX + _v2.z * fwdZ;
    if (dot < FOV_COS && dist > 3.5) return { dist, vis: 0 }; // can always sense someone touching them

    _ray.set(_v1, _v2);
    _ray.far = dist - 0.3;
    const blocked = _ray.intersectObjects(this.world.losMeshes, false).length > 0;
    if (blocked) return { dist, vis: 0 };

    this.canSee = true;
    let vis = Math.max(0.15, 1 - dist / viewDist);
    if (playerCrouched) vis *= 0.45;
    return { dist, vis };
  }

  update(dt, time, ctx) {
    if (this.state === G_STATE.DEAD) {
      if (this.deathT >= 0 && this.deathT < 0.4) {
        this.deathT += dt;
        const k = Math.min(1, this.deathT / 0.4);
        this.group.rotation.x = -k * Math.PI / 2;
      }
      return;
    }

    const { dist, vis } = this.checkVision(ctx.playerEye, ctx.crouched, dt);

    // --- detection meter ---
    if (vis > 0) {
      let rate = 1.5 * vis * (ctx.litBySearchlight ? 1.8 : 1);
      if (dist < 7) rate = 4.5;
      this.detection = Math.min(1, this.detection + rate * dt);
      this.lastKnown.copy(ctx.playerPos);
    } else {
      this.detection = Math.max(0, this.detection - 0.3 * dt);
    }

    if (this.detection >= 1 && this.state !== G_STATE.ALERT) {
      this.goAlert(ctx.playerPos);
      ctx.broadcastAlert(this);
    } else if (this.detection > 0.35 && this.state === G_STATE.PATROL) {
      this.state = G_STATE.SUSP;
      this.suspPos.copy(ctx.playerPos);
      this.suspT = 0;
    }

    // alarm "radio": while the base alarm is live, everyone tracks the player
    if (ctx.alarmActive && this.state !== G_STATE.ALERT) this.goAlert(ctx.playerPos);
    if (ctx.alarmActive && time - ctx.lastRadioPing < 0.1) this.lastKnown.copy(ctx.playerPos);

    switch (this.state) {
      case G_STATE.PATROL: this.doPatrol(dt); break;
      case G_STATE.SUSP: this.doSuspicious(dt); break;
      case G_STATE.ALERT: this.doAlert(dt, dist, ctx); break;
    }

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  doPatrol(dt) {
    if (this.waypoints.length === 1) {
      // static sentry: slow scan
      this.yaw += Math.sin(performance.now() * 0.0004) * dt * 0.4;
      return;
    }
    if (this.waitT > 0) { this.waitT -= dt; return; }
    const wp = this.waypoints[this.wpIndex];
    const d = this.moveToward(wp.x, wp.z, 2.0, dt);
    if (d < 0.6) {
      this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
      this.waitT = 0.8 + Math.random() * 1.6;
    }
  }

  doSuspicious(dt) {
    this.suspT += dt;
    if (this.suspT < 1.2) {
      this.faceToward(this.suspPos.x, this.suspPos.z, dt);
    } else {
      const d = this.moveToward(this.suspPos.x, this.suspPos.z, 1.3, dt);
      if (d < 1.5 || this.suspT > 12) {
        if (this.suspT > 16 || (d < 1.5 && this.suspT > 6)) {
          if (this.detection < 0.2) this.state = G_STATE.PATROL;
        }
      }
    }
    if (this.detection <= 0 && this.suspT > 5) this.state = G_STATE.PATROL;
  }

  doAlert(dt, dist, ctx) {
    if (this.canSee && dist < 42) {
      this.faceToward(ctx.playerPos.x, ctx.playerPos.z, dt, 8);
      this.searchT = 0;
      // burst fire
      this.burstCd -= dt;
      if (this.burstCd <= 0 && this.pendingShots === 0) {
        this.pendingShots = 3;
        this.shotTimer = 0;
        this.burstCd = 1.25 + Math.random() * 0.7;
      }
      if (this.pendingShots > 0) {
        this.shotTimer -= dt;
        if (this.shotTimer <= 0) {
          this.pendingShots--;
          this.shotTimer = 0.09;
          ctx.guardFire(this, dist);
        }
      }
    } else {
      const d = this.moveToward(this.lastKnown.x, this.lastKnown.z, 4.2, dt);
      if (d < 1.5) {
        this.searchT += dt;
        this.yaw += dt * 1.6 * Math.sin(this.searchT * 2.1);
        if (this.searchT > 7 && !ctx.alarmActive) {
          this.state = G_STATE.SUSP;
          this.suspPos.copy(this.lastKnown);
          this.suspT = 0;
          this.detection = 0.3;
        }
      }
    }
  }

  goAlert(knownPos) {
    if (this.state === G_STATE.DEAD) return;
    this.state = G_STATE.ALERT;
    this.detection = 1;
    this.lastKnown.copy(knownPos);
    this.searchT = 0;
  }

  hearNoise(pos, instant) {
    if (this.state === G_STATE.DEAD) return;
    if (instant) {
      this.goAlert(pos);
    } else if (this.state === G_STATE.PATROL || this.state === G_STATE.SUSP) {
      this.state = G_STATE.SUSP;
      this.suspPos.copy(pos);
      this.suspT = 0;
      this.detection = Math.max(this.detection, 0.5);
    }
  }
}

export class GuardManager {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.guards = world.guardDefs.map(def => new Guard(scene, def, world));
    this.tracers = [];
    this.lastRadioPing = 0;
    this.onPlayerHit = null; // set by main: (dmg) => {}
  }

  aliveGuards() { return this.guards.filter(g => g.state !== G_STATE.DEAD); }
  anyAlert() { return this.guards.some(g => g.state === G_STATE.ALERT); }

  maxDetection() {
    let m = 0;
    for (const g of this.guards) {
      if (g.state !== G_STATE.DEAD && g.state !== G_STATE.ALERT) m = Math.max(m, g.detection);
    }
    return m;
  }

  allAlert(playerPos) {
    for (const g of this.guards) g.goAlert(playerPos);
  }

  notifyNoise(pos, radius, instant = false) {
    for (const g of this.guards) {
      if (g.state === G_STATE.DEAD) continue;
      const d = Math.hypot(g.pos.x - pos.x, g.pos.z - pos.z);
      if (d < radius) g.hearNoise(pos, instant);
    }
  }

  damageGuard(guard, dmg, isHead) {
    if (guard.state === G_STATE.DEAD) return false;
    guard.hp -= dmg * (isHead ? 2.5 : 1);
    if (guard.hp <= 0) {
      guard.state = G_STATE.DEAD;
      guard.deathT = 0;
      guard.group.traverse(o => { o.castShadow = false; });
      return true;
    }
    guard.goAlert(guard.lastKnown.lengthSq() > 0 ? guard.lastKnown : guard.pos);
    return false;
  }

  spawnTracer(from, to, color = 0xffe8a0) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, fog: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, ttl: 0.07 });
  }

  update(dt, time, player, alarmActive, litBySearchlight) {
    if (alarmActive && time - this.lastRadioPing > 3) this.lastRadioPing = time;

    const playerEye = _v1.set(player.pos.x, player.pos.y + player.eyeHeight(), player.pos.z).clone();

    const ctx = {
      playerPos: player.pos,
      playerEye,
      crouched: player.crouched,
      alarmActive,
      litBySearchlight,
      lastRadioPing: this.lastRadioPing,
      broadcastAlert: (src) => {
        for (const g of this.guards) {
          if (g === src || g.state === G_STATE.DEAD || g.state === G_STATE.ALERT) continue;
          const d = Math.hypot(g.pos.x - src.pos.x, g.pos.z - src.pos.z);
          if (d < 40) g.goAlert(src.lastKnown);
        }
      },
      guardFire: (g, dist) => {
        const muzzle = new THREE.Vector3(
          g.pos.x + Math.sin(g.yaw) * 0.6, 1.3, g.pos.z + Math.cos(g.yaw) * 0.6);
        const hitChance = Math.max(0.05, Math.min(0.4,
          0.42 - dist * 0.006 - (player.crouched ? 0.07 : 0)));
        const hit = Math.random() < hitChance;
        const end = playerEye.clone();
        if (!hit) {
          end.x += (Math.random() - 0.5) * 3;
          end.y += (Math.random() - 0.5) * 2;
          end.z += (Math.random() - 0.5) * 3;
        }
        this.spawnTracer(muzzle, end, 0xffb060);
        this.audio.enemyShot(dist);
        if (hit && this.onPlayerHit) this.onPlayerHit(7 + Math.random() * 6);
      },
    };

    for (const g of this.guards) g.update(dt, time, ctx);

    // fade tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.ttl -= dt;
      if (t.ttl <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }
}
