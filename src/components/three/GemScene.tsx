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
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#1a1a22');
    g.addColorStop(0.5, '#050506');
    g.addColorStop(1, '#0e0e13');
    x.fillStyle = g;
    x.fillRect(0, 0, 1024, 512);

    const bars: Array<[number, string, number]> = [
      [180, '#f0f0f5', 60],
      [520, '#e5848a', 40],
      [760, '#8fb0f0', 46],
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
        color: 0xc21f31,
        metalness: 0.45,
        roughness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        reflectivity: 1,
        envMapIntensity: 2.0,
        flatShading: true,
        transmission: 0.12,
        thickness: 1.6,
        ior: 2.42,
      }),
    [],
  );

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.35;
      groupRef.current.position.y = Math.sin(t * 0.6) * 0.06;
    }
  });

  return (
    <group ref={groupRef} rotation={[0.12, 0, 0]}>
      {/* crown (inverted cone) */}
      <mesh material={material} position={[0, 0.62, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1.5, 0.75, 8, 1]} />
      </mesh>
      {/* table */}
      <mesh material={material} position={[0, 1.13, 0]}>
        <cylinderGeometry args={[0.72, 1.5, 0.28, 8]} />
      </mesh>
      {/* pavilion */}
      <mesh material={material} position={[0, -0.42, 0]}>
        <coneGeometry args={[1.5, 2.1, 8, 2]} />
      </mesh>
    </group>
  );
}

/** The rotating brilliant-cut ruby for the landing hero. */
export function GemScene() {
  return (
    <Canvas
      camera={{ fov: 35, position: [0, 0, 6.4], near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight color={0x404050} intensity={0.7} />
      <pointLight color={0xffffff} intensity={1.1} distance={30} position={[4, 6, 6]} />
      <pointLight color={0xe5848a} intensity={1.4} distance={30} position={[-5, -2, 3]} />
      <pointLight color={0x8fb0f0} intensity={0.9} distance={30} position={[2, -4, -4]} />
      <Suspense fallback={null}>
        <Gem />
      </Suspense>
    </Canvas>
  );
}
