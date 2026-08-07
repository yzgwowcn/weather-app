// 流体玻璃背景：reactbits.dev FluidGlass（lens 模式）的 vanilla three.js 移植。
// 原组件：https://github.com/DavidHDev/react-bits/blob/main/src/content/Components/FluidGlass/FluidGlass.jsx
// 复刻参数：chromaticAberration=0.1、scale=0.15、ior=1.1（demo 页面 URL 参数）。
// 实现要点（与 drei MeshTransmissionMaterial 一致）：
//   1) 独立背景 scene 每帧渲染到 FBO；
//   2) 透镜 mesh（lens.glb 的 Cylinder）用 MeshPhysicalMaterial + onBeforeCompile 注入
//      transmission shader：IOR 折射采样 buffer + 三通道 chromatic aberration + 体积衰减；
//   3) 透镜跟随指针（指数阻尼，等价 maath easing.damp3，smoothTime=0.15）。
// 折射内容：网站暖金蓝背景渐变（与 body 背景一致）+ 柔和彩色光斑。
// 遵守 prefers-reduced-motion：静态渲染一帧，不跟随、不漂移。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const LENS_URL = 'assets/3d/lens.glb';
const PARAMS = { ior: 1.1, thickness: 5, anisotropy: 0.01, chromaticAberration: 0.1, scale: 0.15, samples: 10, smoothTime: 0.15 };

// ---- FluidTransmissionMaterial：drei MeshTransmissionMaterialImpl 的 vanilla 移植 ----
// shader 注入代码与 drei 逐字一致（MIT © drei 作者），仅去掉 React 包装。
class FluidTransmissionMaterial extends THREE.MeshPhysicalMaterial {
  constructor(samples = PARAMS.samples) {
    super();
    this.uniforms = {
      chromaticAberration: { value: 0.05 },
      // transmission 必须保持 0，否则 three 渲染器会执行额外内置 transmission pass；
      // 用 _transmission 代替（原因同 drei 注释）
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
    };
    this.onBeforeCompile = (shader) => {
      shader.uniforms = { ...shader.uniforms, ...this.uniforms };
      // 强制启用 transmission 块（three 不会为 transmission=0 注入 define）
      shader.defines.USE_TRANSMISSION = '';

      // Head：uniforms + 噪声/扰动函数
      shader.fragmentShader = `uniform float chromaticAberration;
      uniform float anisotropicBlur;
      uniform float time;
      uniform float distortion;
      uniform float distortionScale;
      uniform float temporalDistortion;
      uniform sampler2D buffer;

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

      // transmission_pars_fragment：以 buffer 为折射采样源
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

      // transmission_fragment：折射采样主循环（含三通道 chromatic aberration）
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

        vec3 pos = vWorldPosition;
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
          vec3 sampleNorm = normalize(n + roughnessFactor * roughnessFactor * 2.0 * normalize(vec3(rand(runningSeed++) - 0.5, rand(runningSeed++) - 0.5, rand(runningSeed++) - 0.5)) * pow(rand(runningSeed++), 0.33) + distortionNormal);
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

// ---- 背景渐变纹理（与 body 背景同款：暖金阳光基调）----
function makeBackgroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 512, 180, 0);
  g.addColorStop(0, '#1b2338');
  g.addColorStop(0.55, '#2a3348');
  g.addColorStop(1, '#192131');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const glow = ctx.createRadialGradient(348, 40, 0, 348, 40, 460);
  glow.addColorStop(0, 'rgba(255, 196, 96, 0.38)');
  glow.addColorStop(0.6, 'rgba(255, 196, 96, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- 柔和光斑纹理（径向渐变）----
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

const BLOB_COLORS = ['rgba(125, 180, 255, 0.9)', 'rgba(242, 192, 99, 0.75)', 'rgba(111, 216, 180, 0.7)', 'rgba(183, 156, 255, 0.7)', 'rgba(255, 143, 135, 0.55)'];

// ---- 状态 ----
let renderer = null;
let scene = null;
let camera = null;
let bgScene = null;
let fbo = null;
let quad = null;
let bgPlane = null;
let lens = null;
let blobs = [];
let clock = null;
let rafId = 0;
let started = false;
let reducedMotion = false;
const pointer = { x: 0, y: 0 };
const target = new THREE.Vector3();
const blobBases = [];

function viewportAt(distance) {
  const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
  return { width: height * camera.aspect, height };
}

function buildBgScene() {
  bgScene = new THREE.Scene();
  // 渐变底平面（铺满 z=0 视口）
  bgPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: makeBackgroundTexture() }),
  );
  const v0 = viewportAt(20);
  bgPlane.scale.set(v0.width, v0.height, 1);
  bgScene.add(bgPlane);
  // 柔和光斑（折射可见性来源）
  const texs = BLOB_COLORS.map(makeBlobTexture);
  BLOB_COLORS.forEach((_, i) => {
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshBasicMaterial({ map: texs[i], transparent: true, depthWrite: false }),
    );
    const spots = [
      { fx: 0.22, fy: 0.26, z: 1.5, s: 3.4, amp: 0.8, speed: 0.12, phase: 0 },
      { fx: 0.78, fy: 0.32, z: 2.2, s: 2.6, amp: 1.1, speed: 0.09, phase: 2.1 },
      { fx: 0.62, fy: 0.74, z: 1.8, s: 3.9, amp: 0.6, speed: 0.14, phase: 4.2 },
      { fx: 0.12, fy: 0.8, z: 2.6, s: 2.2, amp: 0.9, speed: 0.11, phase: 1.3 },
      { fx: 0.42, fy: 0.55, z: 3.2, s: 1.7, amp: 1.3, speed: 0.16, phase: 3.0 },
    ][i];
    blob.scale.setScalar(spots.s);
    blob.position.z = spots.z;
    blobBases.push({ ...spots, mesh: blob });
    bgScene.add(blob);
  });
  placeBlobs();
}

function placeBlobs() {
  const v0 = viewportAt(20);
  blobBases.forEach((b) => {
    b.mesh.position.x = (b.fx - 0.5) * v0.width;
    b.mesh.position.y = (b.fy - 0.5) * v0.height;
  });
}

function init() {
  if (started) return;
  started = true;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch (err) {
    started = false;
    return; // WebGL 不可用时静默降级为纯 CSS 毛玻璃
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x0c1626, 1);
  const canvas = renderer.domElement;
  canvas.id = 'fluid-glass';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(15, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 20);

  // FBO：背景 scene 渲染目标
  fbo = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { samples: 4 });
  buildBgScene();

  // 全屏 quad 显示 FBO 纹理（背景）
  quad = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: fbo.texture, transparent: true }),
  );
  const v0 = viewportAt(20);
  quad.scale.set(v0.width, v0.height, 1);
  scene.add(quad);

  // 透镜（lens.glb 的 Cylinder，Draco 压缩），加载完成后开启动画
  const material = new FluidTransmissionMaterial(PARAMS.samples);
  material.buffer = fbo.texture; // 折射采样源：背景 scene 的 FBO 纹理（对应 drei 的 buffer prop）
  material.ior = PARAMS.ior;
  material.thickness = PARAMS.thickness;
  material.anisotropy = PARAMS.anisotropy;
  material.chromaticAberration = PARAMS.chromaticAberration;
  material.anisotropicBlur = PARAMS.anisotropy;
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('vendor/draco/');
  loader.setDRACOLoader(draco);
  loader.load(LENS_URL, (gltf) => {
    const node = gltf.scene.getObjectByName('Cylinder');
    if (!node || !node.geometry) return;
    const geo = node.geometry.clone();
    geo.computeBoundingBox();
    lens = new THREE.Mesh(geo, material);
    lens.rotation.x = Math.PI / 2;
    lens.scale.setScalar(PARAMS.scale);
    lens.position.z = 15;
    lens.frustumCulled = false;
    scene.add(lens);
    if (reducedMotion) {
      renderFrame(0, true);
    } else {
      clock = new THREE.Clock();
      renderer.setAnimationLoop(animate);
    }
  }, undefined, () => { /* 模型加载失败：保持纯 CSS 毛玻璃背景 */ });

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
}

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fbo.setSize(window.innerWidth, window.innerHeight);
  const v0 = viewportAt(20);
  quad.scale.set(v0.width, v0.height, 1);
  bgPlane.scale.set(v0.width, v0.height, 1);
  placeBlobs();
}

function renderFrame(delta, staticFrame) {
  // 透镜跟随指针（指数阻尼，等价 maath damp3 smoothTime=0.15）
  if (lens && !staticFrame) {
    const v = viewportAt(5); // 透镜所在 z=15 平面
    target.set((pointer.x * v.width) / 2, (pointer.y * v.height) / 2, 15);
    const k = 1 - Math.exp(-delta * 2 / PARAMS.smoothTime);
    lens.position.x += (target.x - lens.position.x) * k;
    lens.position.y += (target.y - lens.position.y) * k;
    lens.position.z = 15;
  }
  // 光斑缓慢漂移
  if (!staticFrame && clock) {
    const t = clock.elapsedTime;
    blobBases.forEach((b) => {
      b.mesh.position.x = (b.fx - 0.5) * viewportAt(20).width + Math.sin(t * b.speed + b.phase) * b.amp;
      b.mesh.position.y = (b.fy - 0.5) * viewportAt(20).height + Math.cos(t * b.speed * 0.8 + b.phase) * b.amp;
    });
  }
  // 背景 scene → FBO
  renderer.setRenderTarget(fbo);
  renderer.clear();
  renderer.render(bgScene, camera);
  renderer.setRenderTarget(null);
  // 主场景（quad + 透镜）
  renderer.render(scene, camera);
}

function animate() {
  renderFrame(clock.getDelta(), false);
}

// reduced-motion：静态渲染一帧（透镜居中，不跟随）
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion = mq.matches;
if (mq.addEventListener) {
  mq.addEventListener('change', (e) => {
    reducedMotion = e.matches;
    if (reducedMotion && clock) {
      renderer.setAnimationLoop(null);
      renderFrame(0, true);
    } else if (!reducedMotion && lens && !clock) {
      clock = new THREE.Clock();
      renderer.setAnimationLoop(animate);
    }
  });
}

init();

