import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * Cena 3D leve: um único plano fullscreen com shader de aurora.
 * Sem geometria pesada, sem post-processing.
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;

  // hash + noise
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.,0.));
    float c = hash(i + vec2(0.,1.));
    float d = hash(i + vec2(1.,1.));
    vec2 u = f*f*(3.-2.*f);
    return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= uResolution.x / uResolution.y;

    float t = uTime * 0.08;
    float n1 = fbm(p * 1.4 + vec2(t, -t*0.6));
    float n2 = fbm(p * 2.2 - vec2(t*0.7, t));

    // faixas de aurora
    float band1 = smoothstep(0.35, 0.75, n1);
    float band2 = smoothstep(0.4, 0.85, n2);

    vec3 violet = vec3(0.545, 0.361, 0.965); // #8B5CF6
    vec3 blue   = vec3(0.231, 0.510, 0.965); // #3B82F6
    vec3 magenta= vec3(0.659, 0.333, 0.969); // #A855F7

    vec3 col = vec3(0.027, 0.027, 0.055); // base #07070d
    col += violet * band1 * 0.65;
    col += blue   * band2 * 0.55;
    col += magenta * band1 * band2 * 0.35;

    // vignette suave
    float r = length(p) * 0.55;
    col *= 1.0 - smoothstep(0.6, 1.4, r) * 0.7;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function AuroraPlane({ paused }: { paused: boolean }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  );

  useFrame((state, delta) => {
    if (paused || !matRef.current) return;
    matRef.current.uniforms.uTime.value += delta;
    const size = state.size;
    matRef.current.uniforms.uResolution.value.set(size.width, size.height);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

export default function AuroraCanvas({ paused = false }: { paused?: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: false, powerPreference: "low-power" }}
      frameloop={paused ? "never" : "always"}
      camera={{ position: [0, 0, 1] }}
      style={{ width: "100%", height: "100%" }}
    >
      <AuroraPlane paused={paused} />
    </Canvas>
  );
}
