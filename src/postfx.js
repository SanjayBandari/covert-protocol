// Post-processing stack: HDR render → UnrealBloom (light glow) → tone map →
// film grain + vignette + subtle chromatic aberration. Multisampled HDR target
// keeps edges clean since the composer bypasses the renderer's own MSAA.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 1.15 },
    uAberration: { value: 0.0016 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration;
    varying vec2 vUv;
    float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      // chromatic aberration grows toward the edges
      float a = uAberration * dot(dir, dir) * 4.0;
      float r = texture2D(tDiffuse, uv - dir * a).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv + dir * a).b;
      vec3 col = vec3(r, g, b);
      // vignette
      float vig = smoothstep(0.9, 0.28, length(dir) * uVignette);
      col *= mix(0.5, 1.0, vig);
      // animated film grain
      float grain = (rand(uv + fract(uTime)) - 0.5) * uGrain;
      col += grain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPostFX(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4, // MSAA inside the composer
  });

  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6,   // strength
    0.7,   // radius
    0.72   // threshold — only lights / emissives / moon glow
  );
  composer.addPass(bloom);

  composer.addPass(new OutputPass()); // tone mapping + sRGB

  const grain = new ShaderPass(GrainVignetteShader);
  composer.addPass(grain); // last pass → renders to screen, in display space

  function setSize(w, h) {
    composer.setSize(w, h);
    bloom.setSize(w, h);
  }

  function render(elapsed) {
    grain.uniforms.uTime.value = elapsed;
    composer.render();
  }

  return { composer, render, setSize, bloom, grain };
}
