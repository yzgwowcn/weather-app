// 流体玻璃面板 — React + @react-three/fiber + @react-three/drei 技术栈。
// 对应 reactbits.dev FluidGlass（lens 模式）的官方实现方案：
//   Canvas（fov 58 / z 20 / alpha 透明）→ 背景世界（明亮网站配色渐变 + 光斑）
//   createPortal 渲染到独立 scene → useFBO 每帧渲染为折射采样源；
//   页面玻璃面板（.workspace/.ec-hero/.metric-grid/.cross-stat/.date-chip）每个渲染为
//   圆角 mesh，材质为 fork 自 drei 的 MeshTransmissionMaterial（ior 1.1 / thickness 5 /
//   chromaticAberration 0.1，与 demo 参数一致；samples 6 控性能）。
// 保留 v1.6 已确认的交互：折射随鼠标轻微流动（uPointerTilt + maath damp3），无透镜。
// 折射内容为明亮网站配色（天蓝/暖金/淡紫），消除 v1.6 深色背景的"黑影"感。
// prefers-reduced-motion：frameloop=demand，静态渲染一帧。
import * as THREE from 'three';
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, createPortal, useFrame, useThree, extend } from '@react-three/fiber';
import { useFBO } from '@react-three/drei';
import { easing } from 'maath';
import htm from 'htm';

const html = htm.bind(React.createElement);

const PARAMS = { ior: 1.15, thickness: 5, anisotropy: 0.01, chromaticAberration: 0.1, samples: 6, pointerStrength: 1.0, pointerOffset: 1.2, smoothTime: 0.15 };
const PANEL_SELECTOR = '.workspace, .ec-hero, .metric-grid, .cross-stat, .date-chip';

// ---- FluidTransmissionMaterial：fork drei MeshTransmissionMaterialImpl（MIT © drei 作者）
// 在 drei 的 shader 注入基础上新增 uPointerTilt（折射法线随鼠标轻微倾斜）。
class FluidTransmissionMaterial extends THREE.MeshPhysicalMaterial {
  constructor(samples = PARAMS.samples) {
    super();
    this.uniforms = {
      chromaticAberration: { value: 0.05 },
      transmission: { value: 0 },
      _transmission: { value: 1 },
      transmissionMap: { value: null },
      roughness: { value: 0 },
      thickness: { value: 0 },
      thicknessMap: { value: null },
      attenuationDistance: { value: Infinity },
      attenuationColor: { value: new THREE.Color('white') },
      anisotropicBlur: { value: 0.1 },
      time: { value: 0 },
      distortion: { value: 0 },
      distortionScale: { value: 0.5 },
      temporalDistortion: { value: 0 },
      buffer: { value: null },
      uPointerTilt: { value: new THREE.Vector3() },
    };
    this.onBeforeCompile = (shader) => {
      shader.uniforms = { ...shader.uniforms, ...this.uniforms };
      shader.defines.USE_TRANSMISSION = '';

      shader.fragmentShader = `uniform float chromaticAberration;
      uniform float anisotropicBlur;
      uniform float time;
      uniform float distortion;
      uniform float distortionScale;
      uniform float temporalDistortion;
      uniform sampler2D buffer;
      uniform vec3 uPointerTilt;

      vec3 random3(vec3 c) {
        float j = 4096.0*sin(dot(c,vec3(17.0, 59.4, 15.0)));
        vec3 r;
        r.z = fract(512.0*j);
        j *= .125;
        r.x = fract(512.0*j);
        j *= .125;
        r.y = fract(512.0*j);
        return r-0.5;
      }

      uint hash( uint x ) {
        x += ( x << 10u );
        x ^= ( x >>  6u );
        x += ( x <<  3u );
        x ^= ( x >> 11u );
        x += ( x << 15u );
        return x;
      }

      uint hash( uvec2 v ) { return hash( v.x ^ hash(v.y)                         ); }
      uint hash( uvec3 v ) { return hash( v.x ^ hash(v.y) ^ hash(v.z)             ); }
      uint hash( uvec4 v ) { return hash( v.x ^ hash(v.y) ^ hash(v.z) ^ hash(v.w) ); }

      float floatConstruct( uint m ) {
        const uint ieeeMantissa = 0x007FFFFFu;
        const uint ieeeOne      = 0x3F800000u;
        m &= ieeeMantissa;
        m |= ieeeOne;
        float  f = uintBitsToFloat( m );
        return f - 1.0;
      }

      float randomBase( float x ) { return floatConstruct(hash(floatBitsToUint(x))); }
      float randomBase( vec2  v ) { return floatConstruct(hash(floatBitsToUint(v))); }
      float randomBase( vec3  v ) { return floatConstruct(hash(floatBitsToUint(v))); }
      float randomBase( vec4  v ) { return floatConstruct(hash(floatBitsToUint(v))); }
      float rand(float seed) {
        float result = randomBase(vec3(gl_FragCoord.xy, seed));
        return result;
      }

      const float F3 =  0.3333333;
      const float G3 =  0.1666667;

      float snoise(vec3 p) {
        vec3 s = floor(p + dot(p, vec3(F3)));
        vec3 x = p - s + dot(s, vec3(G3));
        vec3 e = step(vec3(0.0), x - x.yzx);
        vec3 i1 = e*(1.0 - e.zxy);
        vec3 i2 = 1.0 - e.zxy*(1.0 - e);
        vec3 x1 = x - i1 + G3;
        vec3 x2 = x - i2 + 2.0*G3;
        vec3 x3 = x - 1.0 + 3.0*G3;
        vec4 w, d;
        w.x = dot(x, x);
        w.y = dot(x1, x1);
        w.z = dot(x2, x2);
        w.w = dot(x3, x3);
        w = max(0.6 - w, 0.0);
        d.x = dot(random3(s), x);
        d.y = dot(random3(s + i1), x1);
        d.z = dot(random3(s + i2), x2);
        d.w = dot(random3(s + 1.0), x3);
        w *= w;
        w *= w;
        d *= w;
        return dot(d, vec4(52.0));
      }

      float snoiseFractal(vec3 m) {
        return 0.5333333* snoise(m)
              +0.2666667* snoise(2.0*m)
              +0.1333333* snoise(4.0*m)
              +0.0666667* snoise(8.0*m);
      }\n` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_pars_fragment>', `
        #ifdef USE_TRANSMISSION
          uniform float _transmission;
          uniform float thickness;
          uniform float attenuationDistance;
          uniform vec3 attenuationColor;
          #ifdef USE_TRANSMISSIONMAP
            uniform sampler2D transmissionMap;
          #endif
          #ifdef USE_THICKNESSMAP
            uniform sampler2D thicknessMap;
          #endif
          uniform vec2 transmissionSamplerSize;
          uniform sampler2D transmissionSamplerMap;
          uniform mat4 modelMatrix;
          uniform mat4 projectionMatrix;
          varying vec3 vWorldPosition;
          vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
            vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
            vec3 modelScale;
            modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
            modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
            modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
            return normalize( refractionVector ) * thickness * modelScale;
          }
          float applyIorToRoughness( const in float roughness, const in float ior ) {
            return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
          }
          vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
            float framebufferLod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
            #ifdef USE_SAMPLER
              #ifdef texture2DLodEXT
                return texture2DLodEXT(transmissionSamplerMap, fragCoord.xy, framebufferLod);
              #else
                return texture2D(transmissionSamplerMap, fragCoord.xy, framebufferLod);
              #endif
            #else
              return texture2D(buffer, fragCoord.xy);
            #endif
          }
          vec3 applyVolumeAttenuation( const in vec3 radiance, const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
            if ( isinf( attenuationDistance ) ) {
              return radiance;
            } else {
              vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
              vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );
              return transmittance * radiance;
            }
          }
          vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
            const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
            const in mat4 viewMatrix, const in mat4 projMatrix, const in float ior, const in float thickness,
            const in vec3 attenuationColor, const in float attenuationDistance ) {
            vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
            vec3 refractedRayExit = position + transmissionRay;
            vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
            vec2 refractionCoords = ndcPos.xy / ndcPos.w;
            refractionCoords += 1.0;
            refractionCoords /= 2.0;
            vec4 transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
            vec3 attenuatedColor = applyVolumeAttenuation( transmittedLight.rgb, length( transmissionRay ), attenuationColor, attenuationDistance );
            vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
            return vec4( ( 1.0 - F ) * attenuatedColor * diffuseColor, transmittedLight.a );
          }
        #endif\n`);

      shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>', `
        material.transmission = _transmission;
        material.transmissionAlpha = 1.0;
        material.thickness = thickness;
        material.attenuationDistance = attenuationDistance;
        material.attenuationColor = attenuationColor;
        #ifdef USE_TRANSMISSIONMAP
          material.transmission *= texture2D( transmissionMap, vUv ).r;
        #endif
        #ifdef USE_THICKNESSMAP
          material.thickness *= texture2D( thicknessMap, vUv ).g;
        #endif

        vec3 pos = vWorldPosition + uPointerTilt * ${PARAMS.pointerOffset.toFixed(1)};
        float runningSeed = 0.0;
        vec3 v = normalize( cameraPosition - pos );
        vec3 n = inverseTransformDirection( normal, viewMatrix );
        vec3 transmission = vec3(0.0);
        float transmissionR, transmissionB, transmissionG;
        float randomCoords = rand(runningSeed++);
        float thickness_smear = thickness * max(pow(roughnessFactor, 0.33), anisotropicBlur);
        vec3 distortionNormal = vec3(0.0);
        vec3 temporalOffset = vec3(time, -time, -time) * temporalDistortion;
        if (distortion > 0.0) {
          distortionNormal = distortion * vec3(snoiseFractal(vec3((pos * distortionScale + temporalOffset))), snoiseFractal(vec3(pos.zxy * distortionScale - temporalOffset)), snoiseFractal(vec3(pos.yxz * distortionScale + temporalOffset)));
        }
        for (float i = 0.0; i < ${samples}.0; i ++) {
          vec3 sampleNorm = normalize(n + roughnessFactor * roughnessFactor * 2.0 * normalize(vec3(rand(runningSeed++) - 0.5, rand(runningSeed++) - 0.5, rand(runningSeed++) - 0.5)) * pow(rand(runningSeed++), 0.33) + distortionNormal + uPointerTilt);
          transmissionR = getIBLVolumeRefraction(
            sampleNorm, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
            pos, modelMatrix, viewMatrix, projectionMatrix, material.ior, material.thickness  + thickness_smear * (i + randomCoords) / float(${samples}),
            material.attenuationColor, material.attenuationDistance
          ).r;
          transmissionG = getIBLVolumeRefraction(
            sampleNorm, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
            pos, modelMatrix, viewMatrix, projectionMatrix, material.ior  * (1.0 + chromaticAberration * (i + randomCoords) / float(${samples})) , material.thickness + thickness_smear * (i + randomCoords) / float(${samples}),
            material.attenuationColor, material.attenuationDistance
          ).g;
          transmissionB = getIBLVolumeRefraction(
            sampleNorm, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
            pos, modelMatrix, viewMatrix, projectionMatrix, material.ior * (1.0 + 2.0 * chromaticAberration * (i + randomCoords) / float(${samples})), material.thickness + thickness_smear * (i + randomCoords) / float(${samples}),
            material.attenuationColor, material.attenuationDistance
          ).b;
          transmission.r += transmissionR;
          transmission.g += transmissionG;
          transmission.b += transmissionB;
        }
        transmission /= ${samples}.0;
        totalDiffuse = mix( totalDiffuse, transmission.rgb, material.transmission );\n`);
    };
    Object.keys(this.uniforms).forEach((name) => {
      Object.defineProperty(this, name, {
        get: () => this.uniforms[name].value,
        set: (v) => { this.uniforms[name].value = v; },
      });
    });
  }
}
extend({ FluidTransmissionMaterial });

// ---- 背景世界资源（随天气状态变化：渐变 + 光斑配色按 body[data-mood] 切换）----
// 饱和但不过亮（v1.7 明亮渐变导致面板发白，改为深蓝紫等中饱和基调）
const MOOD_BG = {
  sunny: { stops: ['#2a4a78', '#5f8fd0', '#f2c063'], blobs: ['rgba(140, 195, 255, 0.7)', 'rgba(255, 205, 120, 0.65)', 'rgba(120, 225, 190, 0.6)', 'rgba(195, 168, 255, 0.6)', 'rgba(255, 165, 150, 0.5)'] },
  cloudy: { stops: ['#3a4658', '#7d8fa8', '#a8b8cc'], blobs: ['rgba(160, 185, 215, 0.6)', 'rgba(200, 210, 225, 0.5)', 'rgba(130, 160, 195, 0.55)', 'rgba(180, 170, 200, 0.5)', 'rgba(150, 175, 205, 0.45)'] },
  windy: { stops: ['#2f4a5e', '#5aa0b8', '#8fd0c9'], blobs: ['rgba(120, 200, 225, 0.6)', 'rgba(140, 220, 200, 0.55)', 'rgba(100, 170, 210, 0.55)', 'rgba(170, 225, 235, 0.5)', 'rgba(110, 190, 215, 0.45)'] },
  rain: { stops: ['#22324a', '#4a6a8a', '#7d9dbb'], blobs: ['rgba(120, 165, 215, 0.6)', 'rgba(100, 140, 195, 0.55)', 'rgba(150, 190, 230, 0.5)', 'rgba(110, 130, 180, 0.5)', 'rgba(140, 170, 210, 0.45)'] },
  storm: { stops: ['#1e2c42', '#40587a', '#6d86a6'], blobs: ['rgba(110, 155, 210, 0.6)', 'rgba(90, 130, 185, 0.55)', 'rgba(140, 180, 225, 0.5)', 'rgba(100, 120, 170, 0.5)', 'rgba(130, 160, 200, 0.45)'] },
  thunder: { stops: ['#2c2450', '#5a4a8a', '#f2c063'], blobs: ['rgba(170, 150, 255, 0.65)', 'rgba(255, 205, 120, 0.6)', 'rgba(130, 110, 220, 0.55)', 'rgba(220, 180, 255, 0.5)', 'rgba(255, 165, 150, 0.45)'] },
  neutral: { stops: ['#26204a', '#4a3d7a', '#8a7dbb'], blobs: ['rgba(150, 130, 230, 0.6)', 'rgba(190, 170, 255, 0.55)', 'rgba(120, 100, 200, 0.55)', 'rgba(210, 190, 255, 0.5)', 'rgba(160, 140, 220, 0.45)'] },
};
function moodKey() {
  const mood = document.body.dataset.mood;
  return MOOD_BG[mood] ? mood : 'neutral';
}
function makeGradientTexture(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 512, 512, 0);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.6, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // 顶部柔和光晕（衬托玻璃高光，不刺眼）
  const glow = ctx.createRadialGradient(380, 60, 0, 380, 60, 420);
  glow.addColorStop(0, 'rgba(255, 235, 200, 0.35)');
  glow.addColorStop(0.6, 'rgba(255, 235, 200, 0.12)');
  glow.addColorStop(1, 'rgba(255, 235, 200, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBlobTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const r = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, color);
  r.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 光斑配置（位置/大小固定，颜色随 mood）：
const BLOB_SPOTS = [
  { fx: 0.2, fy: 0.24, z: 1.5, s: 3.8, amp: 0.9, speed: 0.12, phase: 0 },
  { fx: 0.8, fy: 0.3, z: 2.2, s: 3.0, amp: 1.2, speed: 0.09, phase: 2.1 },
  { fx: 0.6, fy: 0.76, z: 1.8, s: 4.2, amp: 0.7, speed: 0.14, phase: 4.2 },
  { fx: 0.1, fy: 0.82, z: 2.6, s: 2.6, amp: 1.0, speed: 0.11, phase: 1.3 },
  { fx: 0.42, fy: 0.5, z: 3.2, s: 2.0, amp: 1.4, speed: 0.16, phase: 3.0 },
];

// ---- 面板几何 ----
function readRadius(el) {
  const css = getComputedStyle(el).borderRadius;
  if (!css || css === '0px') return 0;
  const m = css.match(/([\d.]+)px/);
  return m ? Number(m[1]) : 0;
}
function roundedRectShape(w, h, r) {
  const r2 = Math.max(0, Math.min(r, w / 2, h / 2));
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r2, -h / 2);
  s.lineTo(w / 2 - r2, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r2);
  s.lineTo(w / 2, h / 2 - r2);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r2, h / 2);
  s.lineTo(-w / 2 + r2, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r2);
  s.lineTo(-w / 2, -h / 2 + r2);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r2, -h / 2);
  return s;
}

// ---- 单个面板：位置/尺寸/圆角同步 + 折射流动 ----
const pointerRef = { x: 0, y: 0 };
window.addEventListener('pointermove', (e) => {
  pointerRef.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerRef.y = -(e.clientY / window.innerHeight) * 2 + 1;
}, { passive: true });

function PanelMesh({ el, buffer }) {
  const mesh = useRef();
  const mat = useRef();
  const { size } = useThree();
  const radiusPx = useMemo(() => readRadius(el), [el]);
  const geomW = useRef(0);
  const geomH = useRef(0);

  useFrame((state, delta) => {
    const m = mesh.current;
    if (!m) return;
    const rect = el.getBoundingClientRect();
    const inView = rect.bottom > 0 && rect.top < size.height && rect.right > 0 && rect.left < size.width;
    m.visible = inView && rect.width > 0 && rect.height > 0;
    if (!m.visible) return;
    const unit = state.viewport.height / size.height;
    m.position.set((rect.left + rect.width / 2 - size.width / 2) * unit, -(rect.top + rect.height / 2 - size.height / 2) * unit, 0.5);
    const w = rect.width * unit;
    const h = rect.height * unit;
    if (Math.abs(w - geomW.current) > unit || Math.abs(h - geomH.current) > unit) {
      m.geometry.dispose();
      m.geometry = new THREE.ShapeGeometry(roundedRectShape(w, h, radiusPx * unit), 8);
      geomW.current = w;
      geomH.current = h;
    }
    // 折射随鼠标流动（maath damp3，等价 demo 的 easing 用法；指针来自 window 监听，
    // 因为 canvas pointer-events: none，R3F 的 state.pointer 不会更新）
    if (mat.current) {
      const mx = (pointerRef.x * state.viewport.width) / 2;
      const my = (pointerRef.y * state.viewport.height) / 2;
      const dx = mx - m.position.x;
      const dy = my - m.position.y;
      const len = Math.hypot(dx, dy) || 1;
      easing.damp3(mat.current.uPointerTilt, [(dx / len) * PARAMS.pointerStrength, (dy / len) * PARAMS.pointerStrength, 0], PARAMS.smoothTime, delta);
    }
  });

  return html`
    <mesh ref=${mesh} frustumCulled=${false}>
      <fluidTransmissionMaterial
        ref=${mat}
        buffer=${buffer}
        ior=${PARAMS.ior}
        thickness=${PARAMS.thickness}
        anisotropy=${PARAMS.anisotropy}
        chromaticAberration=${PARAMS.chromaticAberration}
        anisotropicBlur=${PARAMS.anisotropy}
        transmission=${0}
      />
    </mesh>`;
}

// ---- 背景世界（渐变 + 光斑配色随 body[data-mood] 切换），渲染进独立 scene 作为折射内容 ----
function BackgroundWorld({ mood }) {
  const viewport = useThree((s) => s.viewport);
  const palette = MOOD_BG[mood] || MOOD_BG.neutral;
  const gradient = useMemo(() => makeGradientTexture(palette.stops), [palette]);
  const blobTexs = useMemo(() => palette.blobs.map(makeBlobTexture), [palette]);
  const blobRefs = useRef([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const vw = state.viewport.width;
    const vh = state.viewport.height;
    blobRefs.current.forEach((ref, i) => {
      if (!ref) return;
      const b = BLOB_SPOTS[i];
      ref.position.x = (b.fx - 0.5) * vw + Math.sin(t * b.speed + b.phase) * b.amp;
      ref.position.y = (b.fy - 0.5) * vh + Math.cos(t * b.speed * 0.8 + b.phase) * b.amp;
    });
  });

  return html`
    <group>
      <mesh scale=${[viewport.width, viewport.height, 1]}>
        <planeGeometry />
        <meshBasicMaterial map=${gradient} />
      </mesh>
      ${BLOB_SPOTS.map((b, i) => html`
        <mesh ref=${(ref) => { blobRefs.current[i] = ref; }} position=${[(b.fx - 0.5) * viewport.width, (b.fy - 0.5) * viewport.height, b.z]} scale=${[b.s, b.s, 1]}>
          <circleGeometry args=${[1, 64]} />
          <meshBasicMaterial map=${blobTexs[i]} transparent=${true} depthWrite=${false} />
        </mesh>`)}
    </group>`;
}

// ---- 主世界：背景 → FBO，面板折射渲染 ----
function GlassWorld() {
  const { gl, camera } = useThree();
  const bgScene = useMemo(() => new THREE.Scene(), []);
  const fbo = useFBO();
  const [panels, setPanels] = useState([]);
  const [mood, setMood] = useState(moodKey());

  // 面板收集：renderResult 重渲染（MutationObserver）与初始扫描
  useEffect(() => {
    const collect = () => setPanels(Array.from(document.querySelectorAll(PANEL_SELECTOR)));
    collect();
    const mo = new MutationObserver(collect);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // 背景世界配色随天气状态（body[data-mood]）变化
  useEffect(() => {
    const update = () => setMood(moodKey());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-mood'] });
    return () => mo.disconnect();
  }, []);

  // 背景世界 → FBO（每帧，主渲染之前）
  useFrame(() => {
    gl.setRenderTarget(fbo);
    gl.render(bgScene, camera);
    gl.setRenderTarget(null);
  });

  return [
    createPortal(html`<${BackgroundWorld} mood=${mood} />`, bgScene),
    ...panels.map((el) => html`<${PanelMesh} key=${el} el=${el} buffer=${fbo.texture} />`),
  ];
}

function App() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return html`
    <${Canvas}
      camera=${{ position: [0, 0, 20], fov: 58 }}
      gl=${{ alpha: true, antialias: true }}
      frameloop=${reduced ? 'demand' : 'always'}
      onCreated=${(state) => state.gl.setClearColor(0x000000, 0)}
      style=${{ width: '100%', height: '100%', display: 'block' }}
    >
      <${GlassWorld} />
    </${Canvas}>`;
}

// ---- 挂载（透明容器，位于内容之下；CSS #fluid-glass 控制层叠）----
function init() {
  if (document.getElementById('fluid-glass')) return;
  const mount = document.createElement('div');
  mount.id = 'fluid-glass';
  mount.setAttribute('aria-hidden', 'true');
  document.body.appendChild(mount);
  createRoot(mount).render(html`<${App} />`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
