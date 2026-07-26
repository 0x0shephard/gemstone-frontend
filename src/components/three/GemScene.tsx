import { useMemo, useRef, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** Procedural environment map — vertical gradient + colored reflection bars. */
function useEnvTexture(): THREE.Texture {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const x = c.getContext('2d')!;
    // Cold near-blacks matching --dc-vault / --dc-card so the stone sits in the
    // same room as the rest of the interface.
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#16191f');
    g.addColorStop(0.5, '#050609');
    g.addColorStop(1, '#0b0d10');
    x.fillStyle = g;
    x.fillRect(0, 0, 1024, 512);

    // Reflection bars are platinum and mercury rather than pink and blue: the
    // surroundings stay achromatic so the stone's own body colour is the only
    // saturated thing in the frame.
    const bars: Array<[number, string, number]> = [
      [180, '#f4f6f9', 60],
      [520, '#e8ebf0', 40],
      [760, '#8891a0', 46],
      [900, '#ffffff', 30],
    ];
    bars.forEach(([px, col, w]) => {
      const lg = x.createLinearGradient(px - w, 0, px + w, 0);
      lg.addColorStop(0, 'transparent');
      lg.addColorStop(0.5, col);
      lg.addColorStop(1, 'transparent');
      x.globalAlpha = 0.5;
      x.fillStyle = lg;
      x.fillRect(px - w, 0, w * 2, 512);
    });
    x.globalAlpha = 1;

    const rg = x.createRadialGradient(512, 60, 10, 512, 60, 420);
    rg.addColorStop(0, 'rgba(255,255,255,.35)');
    rg.addColorStop(1, 'transparent');
    x.fillStyle = rg;
    x.fillRect(0, 0, 1024, 300);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  }, []);
}

function Gem() {
  const groupRef = useRef<THREE.Group>(null);
  const { gl, scene } = useThree();
  const envTex = useEnvTexture();

  // Prefilter env map for physically-based reflections, set as scene environment.
  useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(envTex).texture;
    return () => pmrem.dispose();
  }, [gl, scene, envTex]);

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        // Transmission stays low on purpose: against the near-black ground a
        // higher value renders the stone effectively invisible.
        color: 0xd12433,
        metalness: 0.45,
        roughness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        reflectivity: 1,
        envMapIntensity: 2.4,
        flatShading: true,
        transmission: 0.12,
        thickness: 1.6,
        ior: 2.42,
      }),
    [],
  );

  // One revolution every ~34s. Slow enough to read as a held object rather than
  // a spinning logo. Frozen entirely when the viewer asks for reduced motion.
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useFrame((state) => {
    if (reduceMotion || !groupRef.current) return;
    const t = state.clock.getElapsedTime();
    groupRef.current.rotation.y = t * 0.185;
    groupRef.current.position.y = Math.sin(t * 0.6) * 0.05;
  });

  // Scaled and re-proportioned so the pavilion sits inside the frame instead of
  // running off the bottom of the panel. 12 sides read as a brilliant cut
  // rather than the chunkier octagon.
  return (
    <group ref={groupRef} rotation={[0.12, 0, 0]} scale={0.82} position={[0, 0.18, 0]}>
      {/* crown (inverted cone) */}
      <mesh material={material} position={[0, 0.62, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1.5, 0.72, 12, 1]} />
      </mesh>
      {/* table */}
      <mesh material={material} position={[0, 1.11, 0]}>
        <cylinderGeometry args={[0.78, 1.5, 0.3, 12]} />
      </mesh>
      {/* pavilion */}
      <mesh material={material} position={[0, -0.52, 0]}>
        <coneGeometry args={[1.5, 1.72, 12, 2]} />
      </mesh>
    </group>
  );
}

/** The rotating brilliant-cut ruby for the landing hero. */
export function GemScene() {
  return (
    <Canvas
      camera={{ fov: 35, position: [0, 0, 7.6], near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      style={{
        width: '100%',
        height: '100%',
        filter: 'drop-shadow(0 26px 60px rgba(0,0,0,.55))',
      }}
    >
      {/*
       * Neutral studio lighting. Colour comes from the stone, not the lamps, so
       * the lamps are driven harder than the old tinted rig to keep the ruby
       * bright without reintroducing a pink or blue cast.
       */}
      <ambientLight color={0x3a4049} intensity={0.95} />
      <pointLight color={0xffffff} intensity={1.7} distance={30} position={[4, 6, 6]} />
      <pointLight color={0xe8ebf0} intensity={1.7} distance={30} position={[-5, -2, 3]} />
      <pointLight color={0xa8b0bc} intensity={1.15} distance={30} position={[2, -4, -4]} />
      <Suspense fallback={null}>
        <Gem />
      </Suspense>
    </Canvas>
  );
}
