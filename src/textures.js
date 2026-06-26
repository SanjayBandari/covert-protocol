// Procedural PBR textures (diffuse + derived normal + roughness) generated on
// canvases at runtime — no image assets shipped. Normal maps are computed from
// a height canvas via a Sobel-style gradient so surfaces catch the moonlight.

import * as THREE from 'three';

function makeCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, repeat, srgb = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// derive a tangent-space normal map from a grayscale height canvas
function normalFromHeight(heightCanvas, strength = 2.2) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const at = (x, y) => {
    x = (x + w) % w; y = (y + h) % h;
    return src[(y * w + x) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1) || 1;
      const i = (y * w + x) * 4;
      img.data[i] = (dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// soft circular blotches for large-scale variation
function blotches(ctx, size, count, colors, rMin, rMax, alpha) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = rMin + Math.random() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = colors[(Math.random() * colors.length) | 0];
    g.addColorStop(0, `rgba(${col},${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// fine per-pixel speckle (grain)
function speckle(ctx, size, amount, dark, light) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.random() < amount) {
      const v = Math.random() < 0.5 ? -dark : light;
      d[i] += v; d[i + 1] += v; d[i + 2] += v;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- CONCRETE ----------
export function makeConcrete(repeat = [2, 2]) {
  const S = 256;
  const diff = makeCanvas(S), ht = makeCanvas(S);
  const dc = diff.getContext('2d'), hc = ht.getContext('2d');

  dc.fillStyle = '#5a5f64'; dc.fillRect(0, 0, S, S);
  hc.fillStyle = '#808080'; hc.fillRect(0, 0, S, S);

  blotches(dc, S, 26, ['80,84,90', '70,72,78', '90,93,98'], 18, 70, 0.18);
  blotches(hc, S, 22, ['150,150,150', '110,110,110'], 18, 70, 0.20);

  // panel seams + a few cracks (grooves in the height map)
  dc.strokeStyle = 'rgba(35,38,42,0.55)';
  hc.strokeStyle = 'rgba(40,40,40,0.9)';
  dc.lineWidth = hc.lineWidth = 2;
  for (const yy of [S * 0.5]) { dc.beginPath(); dc.moveTo(0, yy); dc.lineTo(S, yy); dc.stroke();
                               hc.beginPath(); hc.moveTo(0, yy); hc.lineTo(S, yy); hc.stroke(); }
  for (let i = 0; i < 5; i++) {
    let x = Math.random() * S, y = Math.random() * S;
    dc.beginPath(); dc.moveTo(x, y); hc.beginPath(); hc.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40;
      dc.lineTo(x, y); hc.lineTo(x, y);
    }
    dc.lineWidth = hc.lineWidth = 1; dc.stroke(); hc.stroke();
  }

  speckle(dc, S, 0.5, 14, 12);
  speckle(hc, S, 0.4, 22, 20);

  return {
    map: toTexture(diff, repeat, true),
    normalMap: toTexture(normalFromHeight(ht, 1.6), repeat),
  };
}

// ---------- GROUND ----------
export function makeGround(repeat = [60, 60]) {
  const S = 256;
  const diff = makeCanvas(S), ht = makeCanvas(S);
  const dc = diff.getContext('2d'), hc = ht.getContext('2d');

  dc.fillStyle = '#222b1e'; dc.fillRect(0, 0, S, S);
  hc.fillStyle = '#808080'; hc.fillRect(0, 0, S, S);

  blotches(dc, S, 40, ['42,52,36', '28,36,24', '48,44,30', '34,40,28'], 12, 55, 0.30);
  blotches(hc, S, 36, ['120,120,120', '160,160,160', '90,90,90'], 10, 50, 0.28);

  // scattered pebbles (bright specks with little bumps)
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = Math.random() * 1.6 + 0.4;
    const g = 38 + Math.random() * 26;
    dc.fillStyle = `rgb(${g},${g - 6},${g - 14})`;
    dc.beginPath(); dc.arc(x, y, r, 0, Math.PI * 2); dc.fill();
    hc.fillStyle = `rgba(190,190,190,0.6)`;
    hc.beginPath(); hc.arc(x, y, r, 0, Math.PI * 2); hc.fill();
  }

  speckle(dc, S, 0.6, 10, 10);
  speckle(hc, S, 0.5, 26, 24);

  return {
    map: toTexture(diff, repeat, true),
    normalMap: toTexture(normalFromHeight(ht, 2.4), repeat),
  };
}

// ---------- METAL ----------
export function makeMetal(repeat = [1, 1]) {
  const S = 256;
  const diff = makeCanvas(S), ht = makeCanvas(S), rough = makeCanvas(S);
  const dc = diff.getContext('2d'), hc = ht.getContext('2d'), rc = rough.getContext('2d');

  dc.fillStyle = '#3a4148'; dc.fillRect(0, 0, S, S);
  hc.fillStyle = '#808080'; hc.fillRect(0, 0, S, S);
  rc.fillStyle = '#777'; rc.fillRect(0, 0, S, S);

  // brushed vertical streaks
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * S;
    const v = (Math.random() - 0.5) * 22;
    dc.strokeStyle = `rgba(${58 + v},${65 + v},${72 + v},0.5)`;
    dc.beginPath(); dc.moveTo(x, 0); dc.lineTo(x + (Math.random() - 0.5) * 4, S); dc.stroke();
    hc.strokeStyle = `rgba(128,128,128,${Math.random() * 0.3})`;
    hc.beginPath(); hc.moveTo(x, 0); hc.lineTo(x, S); hc.stroke();
  }
  // rust / wear patches (rougher + darker)
  blotches(dc, S, 14, ['74,52,34', '60,42,28', '52,56,60'], 10, 40, 0.22);
  blotches(rc, S, 14, ['180,180,180', '210,210,210'], 10, 40, 0.5);

  // rivets
  for (const [x, y] of [[24, 24], [232, 24], [24, 232], [232, 232], [128, 128]]) {
    const g = dc.createRadialGradient(x, y, 0, x, y, 5);
    g.addColorStop(0, 'rgba(150,156,162,0.9)');
    g.addColorStop(1, 'rgba(40,44,48,0.0)');
    dc.fillStyle = g; dc.beginPath(); dc.arc(x, y, 5, 0, Math.PI * 2); dc.fill();
    hc.fillStyle = 'rgba(220,220,220,0.9)';
    hc.beginPath(); hc.arc(x, y, 3, 0, Math.PI * 2); hc.fill();
  }

  return {
    map: toTexture(diff, repeat, true),
    normalMap: toTexture(normalFromHeight(ht, 1.0), repeat),
    roughnessMap: toTexture(rough, repeat),
  };
}
