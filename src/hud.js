// HUD: health/ammo/objective readouts, detection bar, and the circular minimap.

import { G_STATE } from './guards.js';

export class HUD {
  constructor() {
    this.els = {
      objText: document.getElementById('objective-text'),
      objDist: document.getElementById('objective-dist'),
      detectBar: document.getElementById('detect-bar'),
      alarm: document.getElementById('alarm-banner'),
      healthBar: document.getElementById('health-bar'),
      ammo: document.getElementById('ammo'),
      weaponName: document.getElementById('weapon-name'),
      reloadHint: document.getElementById('reload-hint'),
      interact: document.getElementById('interact-prompt'),
      hitmarker: document.getElementById('hitmarker'),
      vignette: document.getElementById('damage-vignette'),
      stance: document.getElementById('stance-indicator'),
    };
    this.map = document.getElementById('minimap');
    this.mctx = this.map.getContext('2d');
    this.hitT = 0;
  }

  showHitmarker(kill) {
    this.els.hitmarker.classList.remove('hidden');
    this.els.hitmarker.classList.toggle('kill', kill);
    this.hitT = 0.12;
  }

  update(dt, player, guards, world, mission, time, lightDetect) {
    const e = this.els;

    // health
    e.healthBar.style.width = `${player.health}%`;
    e.healthBar.style.background = player.health > 50 ? 'var(--green)'
      : player.health > 25 ? 'var(--amber)' : 'var(--red)';

    // damage vignette
    const sinceHit = time - player.lastDamageT;
    e.vignette.style.opacity = sinceHit < 0.4 ? '1'
      : Math.max(0, 1 - (sinceHit - 0.4) / 0.8) * (player.health < 30 ? 0.7 : 0.45);

    // weapon
    const w = player.weapon();
    e.weaponName.textContent = w.name + (w.suppressed ? '  [SUPPRESSED]' : '');
    e.ammo.innerHTML = `${w.mag} <span>/ ${w.reserve}</span>`;
    e.reloadHint.classList.toggle('hidden', player.reloadT <= 0);

    // stance
    e.stance.textContent = player.crouched ? '▼ CROUCHED' : '▲ STANDING';
    e.stance.style.color = player.crouched ? 'var(--cyan)' : 'var(--green-dim)';

    // detection bar = loudest non-alert guard + searchlight meter
    const det = Math.max(guards.maxDetection(), lightDetect);
    e.detectBar.style.width = `${Math.round(det * 100)}%`;
    e.detectBar.style.background = det > 0.7 ? 'var(--red)' : 'var(--amber)';

    // alarm banner
    e.alarm.classList.toggle('hidden', !mission.alarmActive);

    // objective
    e.objText.textContent = mission.text;
    const target = mission.targetPos;
    if (target) {
      const d = Math.hypot(target.x - player.pos.x, target.z - player.pos.z);
      e.objDist.textContent = `▸ ${Math.round(d)}m`;
    } else {
      e.objDist.textContent = '';
    }

    // interact prompt
    e.interact.classList.toggle('hidden', !mission.showInteract);
    if (mission.showInteract && mission.plantProgress > 0) {
      e.interact.innerHTML = `PLANTING… ${Math.round(mission.plantProgress / 3 * 100)}%`;
    } else if (mission.showInteract) {
      e.interact.innerHTML = 'HOLD <b>E</b> TO PLANT THE CHARGE';
    }

    // hitmarker
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) e.hitmarker.classList.add('hidden');
    }

    this.drawMinimap(player, guards, world, mission, time);
  }

  drawMinimap(player, guards, world, mission, time) {
    const ctx = this.mctx;
    const W = 200, C = W / 2, R = 96;
    const range = 85; // metres from player to map edge
    const s = R / range;
    const px = player.pos.x, pz = player.pos.z;

    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = 'rgba(10, 18, 14, 0.85)';
    ctx.fillRect(0, 0, W, W);

    // structures
    for (const c of world.colliders) {
      const x = (c.minX - px) * s + C;
      const y = (c.minZ - pz) * s + C;
      const w = (c.maxX - c.minX) * s;
      const h = (c.maxZ - c.minZ) * s;
      if (x + w < 0 || x > W || y + h < 0 || y > W) continue;
      ctx.fillStyle = c.type === 'wall' ? '#46505c'
        : c.type === 'crate' ? '#5a5440'
        : c.type === 'rock' ? '#3c4044' : '#39414a';
      ctx.fillRect(x, y, Math.max(w, 2), Math.max(h, 2));
    }

    // searchlight spots
    for (const sl of world.searchlights) {
      const x = (sl.spotCenter.x - px) * s + C;
      const y = (sl.spotCenter.z - pz) * s + C;
      ctx.beginPath();
      ctx.arc(x, y, 4 * s + 2, 0, Math.PI * 2);
      ctx.fillStyle = mission.alarmActive ? 'rgba(255,80,64,0.25)' : 'rgba(255,242,192,0.22)';
      ctx.fill();
    }

    // guards
    for (const g of guards.guards) {
      if (g.state === G_STATE.DEAD) continue;
      const x = (g.pos.x - px) * s + C;
      const y = (g.pos.z - pz) * s + C;
      if (x < -5 || x > W + 5 || y < -5 || y > W + 5) continue;
      ctx.fillStyle = g.state === G_STATE.ALERT ? '#e04a3a'
        : g.state === G_STATE.SUSP ? '#e8b84a' : '#cf8a5a';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      // facing tick
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(g.yaw) * 6, y + Math.cos(g.yaw) * 6);
      ctx.stroke();
    }

    // objective marker (clamped to map edge)
    if (mission.targetPos) {
      let mx = (mission.targetPos.x - px) * s;
      let my = (mission.targetPos.z - pz) * s;
      const d = Math.hypot(mx, my);
      if (d > R - 8) { mx *= (R - 8) / d; my *= (R - 8) / d; }
      const pulse = 4 + Math.sin(time * 5) * 1.5;
      ctx.strokeStyle = '#e8e84a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(C + mx, C + my, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // player arrow (camera yaw; forward = up at yaw 0)
    const yaw = player.camera.rotation.y;
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#d7e3bb';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();

    // ring + north marker
    ctx.strokeStyle = 'rgba(159,184,107,0.45)';
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#9fb86b';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', C, 12);
  }
}
