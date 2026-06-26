// COVERT PROTOCOL — entry point and game loop.

import * as THREE from 'three';
import { buildWorld } from './world.js';
import { GuardManager } from './guards.js';
import { Player } from './player.js';
import { HUD } from './hud.js';
import { AudioFX } from './audio.js';
import { createPostFX } from './postfx.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.domElement.classList.add('game');
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 700);
scene.add(camera);

const postfx = createPostFX(renderer, scene, camera);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// ---------- game objects ----------
const world = buildWorld(scene);
const audio = new AudioFX();
const player = new Player(camera, world, audio);
const guards = new GuardManager(scene, world, audio);
const hud = new HUD();

player.setTargets(guards);
player.onShoot = (radius) => guards.notifyNoise(player.pos, radius, false);
player.onHit = (killed) => { hud.showHitmarker(killed); if (killed) stats.kills++; };
guards.onPlayerHit = (dmg) => player.takeDamage(dmg);

// ---------- state ----------
const STATE = { MENU: 0, PLAYING: 1, PAUSED: 2, DEAD: 3, WON: 4 };
let state = STATE.MENU;

const mission = {
  phase: 0,             // 0 = reach tower & plant, 1 = exfiltrate
  text: 'REACH THE COMMS TOWER',
  targetPos: world.plantPos,
  showInteract: false,
  plantProgress: 0,
  alarmActive: false,
  permanentAlarm: false,
};

const stats = { kills: 0, startT: 0, alarmsRaised: 0 };
let lightDetect = 0;       // searchlight detection meter
let alarmWasActive = false;

// ---------- UI ----------
const $ = id => document.getElementById(id);
const ui = {
  hud: $('hud'), menu: $('menu'), paused: $('paused'), dead: $('dead'), win: $('win'),
  winStats: $('win-stats'),
};

function lockPointer() {
  renderer.domElement.requestPointerLock().catch(() => { /* cooldown — user clicks again */ });
}

$('btn-deploy').addEventListener('click', () => {
  audio.init();
  camera.rotation.set(0, 0, 0); // face the base (menu orbit leaves the camera askew)
  state = STATE.PLAYING;
  stats.startT = performance.now() / 1000;
  ui.menu.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  lockPointer();
});
$('btn-resume').addEventListener('click', lockPointer);
$('btn-retry').addEventListener('click', () => location.reload());
$('btn-replay').addEventListener('click', () => location.reload());

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) {
    if (state === STATE.PAUSED) state = STATE.PLAYING;
    ui.paused.classList.add('hidden');
  } else if (state === STATE.PLAYING) {
    state = STATE.PAUSED;
    ui.paused.classList.remove('hidden');
  }
});

// ---------- mission logic ----------
function updateMission(dt, time) {
  if (mission.phase === 0) {
    const d = Math.hypot(world.plantPos.x - player.pos.x, world.plantPos.z - player.pos.z);
    mission.text = d < 6 ? 'PLANT THE DEMOLITION CHARGE' : 'REACH THE COMMS TOWER';
    mission.showInteract = d < 4.5;
    if (mission.showInteract && player.keys['KeyE']) {
      if (mission.plantProgress === 0) audio.beep();
      mission.plantProgress += dt;
      if (mission.plantProgress >= 3) {
        mission.phase = 1;
        mission.showInteract = false;
        mission.plantProgress = 0;
        mission.text = 'CHARGE ARMED — REACH THE EXTRACTION BEACON';
        mission.targetPos = world.extractionPos;
        mission.permanentAlarm = true;
        world.charge.visible = true;
        world.beacon.visible = true;
        audio.planted();
        guards.allAlert(player.pos);
        stats.alarmsRaised++;
      }
    } else {
      mission.plantProgress = Math.max(0, mission.plantProgress - dt * 2);
    }
  } else {
    const d = Math.hypot(world.extractionPos.x - player.pos.x, world.extractionPos.z - player.pos.z);
    if (d < 5.5) return winMission(time);
  }
}

function winMission(time) {
  state = STATE.WON;
  document.exitPointerLock();
  const elapsed = time - stats.startT;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
  ui.winStats.innerHTML =
    `MISSION TIME &nbsp;${mm}:${ss}<br>` +
    `HOSTILES NEUTRALIZED &nbsp;${stats.kills} / ${guards.guards.length}<br>` +
    `RATING &nbsp;${stats.kills <= 3 ? 'GHOST' : stats.kills <= 6 ? 'OPERATIVE' : 'JUGGERNAUT'}`;
  ui.hud.classList.add('hidden');
  ui.win.classList.remove('hidden');
  audio.setAlarm(false);
  audio.stinger(true);
}

function failMission() {
  state = STATE.DEAD;
  document.exitPointerLock();
  ui.hud.classList.add('hidden');
  ui.dead.classList.remove('hidden');
  audio.setAlarm(false);
  audio.stinger(false);
}

// ---------- main loop ----------
let lastT = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const time = now / 1000;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  world.updateProps(time);

  if (state === STATE.PLAYING) {
    player.update(dt, time);

    // searchlights
    const lit = world.updateSearchlights(dt, time, player.pos, player.crouched);
    if (lit) {
      lightDetect = Math.min(1, lightDetect + dt * 1.1);
      if (lightDetect >= 1) {
        guards.allAlert(player.pos);
        stats.alarmsRaised++;
      }
    } else {
      lightDetect = Math.max(0, lightDetect - dt * 0.5);
    }

    // alarm state
    mission.alarmActive = guards.anyAlert() || mission.permanentAlarm;
    if (mission.alarmActive && !alarmWasActive) stats.alarmsRaised++;
    alarmWasActive = mission.alarmActive;
    audio.setAlarm(mission.alarmActive);
    world.setAlarmVisual(mission.alarmActive);

    guards.update(dt, time, player, mission.alarmActive, lit);
    updateMission(dt, time);
    hud.update(dt, player, guards, world, mission, time, lightDetect);

    if (player.dead) failMission();
  } else if (state === STATE.MENU) {
    // slow orbiting establishing shot behind the menu
    const a = time * 0.05;
    camera.position.set(Math.sin(a) * 95, 26, Math.cos(a) * 95);
    camera.lookAt(0, 4, 0);
    world.updateSearchlights(dt, time, camera.position, false);
  }

  postfx.render(time);
}

requestAnimationFrame(loop);
