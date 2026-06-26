// World construction: terrain, base structures, lighting, searchlights,
// colliders for movement, and occluder meshes for line-of-sight checks.

import * as THREE from 'three';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#222b1e';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.66 ? '#2a3424' : v > 0.33 ? '#1c2418' : '#28301f';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWorld(scene) {
  const colliders = [];   // {minX,maxX,minZ,maxZ,type} — XZ AABBs for movement
  const losMeshes = [];   // meshes that block vision

  const matWall = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.95 });
  const matConcrete = new THREE.MeshStandardMaterial({ color: 0x575b60, roughness: 0.9 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.6, metalness: 0.55 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0x6e5b3f, roughness: 0.9 });
  const matRock = new THREE.MeshStandardMaterial({ color: 0x474c50, roughness: 1.0 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.85 });

  function addBox(w, h, d, x, z, mat, { y = null, collide = true, los = true, type = 'building', rotY = 0 } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, (y === null ? h / 2 : y), z);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (collide) {
      // approximate rotated boxes with their world-space extent (rotY is 0 or small here)
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, type });
    }
    if (los) losMeshes.push(m);
    return m;
  }

  // ---------- sky / atmosphere ----------
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x070b14, 0.0085);

  // stars
  {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(Math.random() * 0.95);  // upper hemisphere
      const r = 380;
      pos[i * 3] = r * Math.sin(p) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.cos(p) + 5;
      pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xcdd8ff, size: 1.1, sizeAttenuation: false, fog: false,
    }));
    scene.add(stars);
  }

  // moon
  {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(9, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xf2efdd, fog: false })
    );
    moon.position.set(-160, 130, -250);
    scene.add(moon);
  }

  // ---------- lighting ----------
  const hemi = new THREE.HemisphereLight(0x33415e, 0x0c100a, 0.55);
  scene.add(hemi);

  const moonLight = new THREE.DirectionalLight(0x9db4e0, 1.5);
  moonLight.position.set(-70, 95, -60);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  moonLight.shadow.camera.left = -120;
  moonLight.shadow.camera.right = 120;
  moonLight.shadow.camera.top = 130;
  moonLight.shadow.camera.bottom = -120;
  moonLight.shadow.camera.far = 320;
  moonLight.shadow.bias = -0.0006;
  scene.add(moonLight);

  // ---------- ground ----------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // dirt road from the south gate
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 120),
    new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 1.0 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, 48);
  road.receiveShadow = true;
  scene.add(road);

  // ---------- perimeter walls (gate gap on the south side, x in [-8, 8]) ----------
  const WALL_H = 4;
  addBox(1.4, WALL_H, 121, -60, 0, matWall, { type: 'wall' });
  addBox(1.4, WALL_H, 121, 60, 0, matWall, { type: 'wall' });
  addBox(121, WALL_H, 1.4, 0, -60, matWall, { type: 'wall' });
  addBox(52, WALL_H, 1.4, -34, 60, matWall, { type: 'wall' });
  addBox(52, WALL_H, 1.4, 34, 60, matWall, { type: 'wall' });
  // gate posts
  addBox(1.6, 5.5, 1.6, -8, 60, matConcrete, { type: 'wall' });
  addBox(1.6, 5.5, 1.6, 8, 60, matConcrete, { type: 'wall' });

  // ---------- watchtowers (corners) ----------
  const searchlights = [];
  const towerSpots = [
    { x: -54, z: -54, light: false },
    { x: 54, z: -54, light: false },
    { x: -54, z: 54, light: true },
    { x: 54, z: 54, light: true },
  ];

  for (const t of towerSpots) {
    const legMat = matMetal;
    for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
      addBox(0.35, 8, 0.35, t.x + lx, t.z + lz, legMat, { collide: false, los: false });
    }
    addBox(4.2, 0.45, 4.2, t.x, t.z, matDark, { y: 8.2, collide: false, los: false });
    addBox(4.6, 0.4, 4.6, t.x, t.z, matDark, { y: 11.2, collide: false, los: false });
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      addBox(0.22, 2.8, 0.22, t.x + lx, t.z + lz, legMat, { y: 9.8, collide: false, los: false });
    }
    // single collider for the whole tower footprint
    colliders.push({ minX: t.x - 1.7, maxX: t.x + 1.7, minZ: t.z - 1.7, maxZ: t.z + 1.7, type: 'wall' });

    if (t.light) {
      const lampH = 9.4;
      const lampPos = new THREE.Vector3(t.x, lampH, t.z);

      const pivot = new THREE.Group();
      pivot.position.copy(lampPos);
      scene.add(pivot);

      // lamp housing
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), matMetal);
      pivot.add(housing);

      // visible beam cone: apex at lamp, extending down/outward
      const spotDist = 20;
      const beamLen = Math.sqrt(lampH * lampH + spotDist * spotDist) + 2;
      const coneGeo = new THREE.ConeGeometry(3.4, beamLen, 20, 1, true);
      coneGeo.translate(0, -beamLen / 2, 0); // apex at origin, extends -Y
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xfff2c0, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      const tiltGroup = new THREE.Group();
      // tilt -Y axis outward toward +Z (then pivot.rotation.y aims it)
      const tilt = Math.atan2(spotDist, lampH);
      cone.rotation.x = -tilt;
      tiltGroup.add(cone);
      pivot.add(tiltGroup);

      // actual spotlight
      const light = new THREE.SpotLight(0xfff2c0, 450, 70, 0.17, 0.45, 1.6);
      light.position.copy(lampPos);
      const target = new THREE.Object3D();
      scene.add(target);
      light.target = target;
      scene.add(light);

      const baseAngle = Math.atan2(-t.x, -t.z); // face base center
      searchlights.push({
        base: new THREE.Vector3(t.x, 0, t.z),
        lampPos, pivot, coneMat, light, target,
        baseAngle, sweep: 0.95, speed: 0.4,
        spotDist, spotCenter: new THREE.Vector3(),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  // ---------- buildings ----------
  const hangar = addBox(22, 8, 14, -38, -10, matConcrete);
  addBox(3.5, 4.5, 0.6, -38, -2.8, matDark, { collide: false, los: false }); // door
  const barracks = addBox(16, 4, 8, 30, -20, matConcrete);
  const commandHut = addBox(10, 3.5, 8, -25, 35, matConcrete);

  // emissive window strips (cheap "interior light" look)
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false });
  function addWindow(w, h, x, y, z, rotY = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), winMat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
  }
  addWindow(2.2, 0.9, 30 - 4, 2.4, -20 + 4.05);
  addWindow(2.2, 0.9, 30 + 4, 2.4, -20 + 4.05);
  addWindow(1.8, 0.8, -25 + 3, 2.1, 35 + 4.05);
  addWindow(2.6, 1.1, -38 + 7, 4.5, -10 + 7.05);

  // fuel tanks
  for (let i = 0; i < 3; i++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 4.5, 16), matMetal);
    tank.position.set(40, 2.25, 14 + i * 5.5);
    tank.castShadow = tank.receiveShadow = true;
    scene.add(tank);
    losMeshes.push(tank);
    colliders.push({ minX: 38, maxX: 42, minZ: 12 + i * 5.5, maxZ: 16 + i * 5.5, type: 'building' });
  }

  // ---------- crates & sandbags ----------
  const cratePlan = [
    [10, 40, 2], [11.8, 40.4, 1], [-15, 20, 2], [15, -15, 3], [16.8, -13.6, 1],
    [-40, 18, 2], [45, -40, 2], [-8, 8, 1], [22, 42, 1], [-30, -40, 2],
  ];
  for (const [cx, cz, stack] of cratePlan) {
    for (let s = 0; s < stack; s++) {
      const size = 1.7 - s * 0.15;
      addBox(size, 1.5, size, cx + (s % 2) * 0.1, cz, matCrate,
        { y: 0.75 + s * 1.5, collide: s === 0, los: s === 0, type: 'crate' });
    }
  }
  // sandbag lines flanking the inner gate
  addBox(6, 1.1, 1.2, -12, 50, matDark, { type: 'crate' });
  addBox(6, 1.1, 1.2, 12, 50, matDark, { type: 'crate' });

  // ---------- rocks outside the wall (approach cover) ----------
  const rockSpots = [[-26, 78, 2.2], [18, 84, 1.8], [-8, 72, 1.5], [34, 70, 2.0], [-42, 70, 2.4], [10, 92, 1.6]];
  for (const [rx, rz, rs] of rockSpots) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rs, 0), matRock);
    rock.position.set(rx, rs * 0.55, rz);
    rock.rotation.set(Math.random(), Math.random() * 3, Math.random());
    rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
    losMeshes.push(rock);
    colliders.push({ minX: rx - rs * 0.8, maxX: rx + rs * 0.8, minZ: rz - rs * 0.8, maxZ: rz + rs * 0.8, type: 'rock' });
  }

  // ---------- pole lights ----------
  const poleSpots = [[-25, 15], [25, 15], [-15, -25], [25, -38]];
  for (const [px, pz] of poleSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 8), matMetal);
    pole.position.set(px, 3, pz);
    pole.castShadow = true;
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
    bulb.position.set(px, 5.9, pz);
    scene.add(bulb);
    const pl = new THREE.PointLight(0xffc878, 38, 30, 1.8);
    pl.position.set(px, 5.6, pz);
    scene.add(pl);
  }

  // ---------- comms tower (objective) ----------
  const towerBase = addBox(3.2, 1.2, 3.2, 0, -40, matConcrete, { type: 'building' });
  for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
    addBox(0.3, 17, 0.3, lx, -40 + lz, matMetal, { collide: false, los: false });
  }
  for (let i = 1; i <= 4; i++) {
    addBox(2.5, 0.18, 2.5, 0, -40, matMetal, { y: i * 3.6, collide: false, los: false });
  }
  // dish
  const dish = new THREE.Mesh(new THREE.ConeGeometry(2.1, 0.9, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
  dish.position.set(0.8, 15.4, -40.8);
  dish.rotation.set(Math.PI / 2.6, 0, 0.4);
  dish.castShadow = true;
  scene.add(dish);
  // blinking aviation light
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false });
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), blinkMat);
  blink.position.set(0, 17.4, -40);
  scene.add(blink);

  // demolition charge prop (hidden until planted)
  const charge = new THREE.Group();
  const chargeBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.18), matDark);
  const chargeLed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3322, fog: false }));
  chargeLed.position.set(0.15, 0.1, 0.1);
  charge.add(chargeBody, chargeLed);
  charge.position.set(0, 1.0, -38.3);
  charge.visible = false;
  scene.add(charge);

  // ---------- extraction beacon ----------
  const beacon = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.12, 28), matDark);
  pad.position.y = 0.06;
  pad.receiveShadow = true;
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.6, 40, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x46ff9a, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    })
  );
  pillar.position.y = 20;
  beacon.add(pad, pillar);
  beacon.position.set(60, 0, 100);
  beacon.visible = false;
  scene.add(beacon);

  // ---------- guard patrol routes ----------
  const guardDefs = [
    { waypoints: [{ x: 0, z: 57 }] },                                              // gate sentry
    { waypoints: [{ x: -14, z: 68 }, { x: 14, z: 68 }] },                          // outer gate patrol
    { waypoints: [{ x: 38, z: 80 }, { x: 64, z: 72 }] },                           // eastern approach
    { waypoints: [{ x: -22, z: 28 }, { x: 22, z: 28 }, { x: 22, z: 6 }, { x: -22, z: 6 }] },
    { waypoints: [{ x: 34, z: -4 }, { x: 34, z: -34 }, { x: 6, z: -34 }] },
    { waypoints: [{ x: -34, z: 4 }, { x: -20, z: -8 }, { x: -34, z: -24 }] },      // hangar round
    { waypoints: [{ x: -8, z: -46 }, { x: 8, z: -46 }] },                          // comms guard A
    { waypoints: [{ x: 6, z: -32 }, { x: -6, z: -32 }] },                          // comms guard B
    { waypoints: [{ x: -44, z: -50 }, { x: 44, z: -50 }] },                        // north sweep
    { waypoints: [{ x: -50, z: 28 }, { x: -50, z: -28 }] },                        // west sweep
  ];

  let alarmOn = false;

  return {
    colliders,
    losMeshes,
    searchlights,
    guardDefs,
    spawnPos: new THREE.Vector3(0, 0, 95),
    plantPos: new THREE.Vector3(0, 0, -37.4),
    extractionPos: new THREE.Vector3(60, 0, 100),
    beacon,
    charge,

    setAlarmVisual(on) {
      if (on === alarmOn) return;
      alarmOn = on;
      for (const s of searchlights) {
        s.coneMat.color.setHex(on ? 0xff5040 : 0xfff2c0);
        s.light.color.setHex(on ? 0xff5040 : 0xfff2c0);
      }
    },

    updateSearchlights(dt, time, playerPos, playerCrouched) {
      let lit = false;
      for (const s of searchlights) {
        const ang = s.baseAngle + Math.sin(time * s.speed + s.phase) * s.sweep;
        s.pivot.rotation.y = ang;
        s.spotCenter.set(
          s.base.x + Math.sin(ang) * s.spotDist,
          0,
          s.base.z + Math.cos(ang) * s.spotDist
        );
        s.target.position.copy(s.spotCenter);
        s.target.updateMatrixWorld();
        const dx = playerPos.x - s.spotCenter.x;
        const dz = playerPos.z - s.spotCenter.z;
        const r = playerCrouched ? 3.4 : 4.2;
        if (dx * dx + dz * dz < r * r) lit = true;
      }
      return lit;
    },

    updateProps(time) {
      blinkMat.color.setHex(Math.sin(time * 4) > 0 ? 0xff2a1a : 0x4a0e08);
      if (beacon.visible) pillar.material.opacity = 0.11 + 0.05 * Math.sin(time * 3);
      if (charge.visible) chargeLed.material.color.setHex(Math.sin(time * 10) > 0 ? 0xff3322 : 0x331008);
    },
  };
}

// circle-vs-AABB collision resolution, shared by player & guards
export function collideAndSlide(pos, radius, colliders) {
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 < 1e-8) {
        // center inside the box — push out along the shallowest axis
        const pushL = pos.x - c.minX, pushR = c.maxX - pos.x;
        const pushB = pos.z - c.minZ, pushF = c.maxZ - pos.z;
        const minPush = Math.min(pushL, pushR, pushB, pushF);
        if (minPush === pushL) pos.x = c.minX - radius;
        else if (minPush === pushR) pos.x = c.maxX + radius;
        else if (minPush === pushB) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      } else {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      }
    }
  }
}
