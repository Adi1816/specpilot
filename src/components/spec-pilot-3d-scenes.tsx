"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import {
  Float,
  MeshTransmissionMaterial,
  Sparkles,
  useCursor,
  useTexture,
} from "@react-three/drei";
import { Suspense, useMemo, useRef, useState } from "react";
import type { Group, Mesh as ThreeMesh, Sprite as ThreeSprite, Texture } from "three";
import { AdditiveBlending, DoubleSide, MathUtils, SRGBColorSpace } from "three";

export type SocialSceneLink = {
  id: "github" | "instagram" | "linkedin";
  label: string;
  href: string;
  texturePath: string;
};

type ExecutiveSceneIconId =
  | "bat"
  | "bookmark"
  | "candy"
  | "chatText"
  | "cup"
  | "eyedropper"
  | "moneyBag"
  | "notebook"
  | "spider"
  | "teaCup"
  | "vamp"
  | "witchHat"
  | "zoom";
type ExecutiveSceneTokenConfig = {
  id: ExecutiveSceneIconId;
  drift: [number, number, number];
  phase: number;
  position: [number, number, number];
  pull: [number, number];
  scale: number;
  speed: number;
  tilt: [number, number, number];
};

const socialAccentMap: Record<SocialSceneLink["id"], { base: string; glow: string }> = {
  github: { base: "#6e5dff", glow: "#b89dff" },
  instagram: { base: "#ff5dad", glow: "#ff9bcb" },
  linkedin: { base: "#5aa8ff", glow: "#b8dcff" },
};

const executiveIconTexturePaths: Record<ExecutiveSceneIconId, string> = {
  bat: "/executive-icons/bat-3d.png",
  bookmark: "/executive-icons/bookmark-3d.png",
  candy: "/executive-icons/candy-3d.png",
  chatText: "/executive-icons/chat-text-3d.png",
  cup: "/executive-icons/cup-3d.png",
  eyedropper: "/executive-icons/eyedropper-3d.png",
  moneyBag: "/executive-icons/money-bag-3d.png",
  notebook: "/executive-icons/notebook-3d.png",
  spider: "/executive-icons/spider-3d.png",
  teaCup: "/executive-icons/tea-cup-3d.png",
  vamp: "/executive-icons/vamp-3d.png",
  witchHat: "/executive-icons/witch-hat-3d.png",
  zoom: "/executive-icons/zoom-3d.png",
};

const executiveTokenConfigs: ExecutiveSceneTokenConfig[] = [
  {
    id: "witchHat",
    drift: [0.1, 0.14, 0.08],
    phase: 0.28,
    position: [2.38, 2.28, -0.5],
    pull: [0.12, 0.07],
    scale: 1.04,
    speed: 0.72,
    tilt: [-0.12, -0.42, 0.22],
  },
  {
    id: "bat",
    drift: [0.12, 0.14, 0.1],
    phase: 1.1,
    position: [-2.42, 2.04, 0.22],
    pull: [0.14, 0.08],
    scale: 1.02,
    speed: 0.9,
    tilt: [0.08, 0.24, -0.14],
  },
  {
    id: "bookmark",
    drift: [0.12, 0.16, 0.08],
    phase: 1.74,
    position: [0.04, 1.96, 0.78],
    pull: [0.1, 0.06],
    scale: 0.94,
    speed: 0.86,
    tilt: [-0.08, 0.04, -0.18],
  },
  {
    id: "eyedropper",
    drift: [0.12, 0.12, 0.08],
    phase: 2.04,
    position: [1.26, 1.22, 1.02],
    pull: [0.1, 0.06],
    scale: 0.86,
    speed: 0.9,
    tilt: [0.22, -0.18, 0.32],
  },
  {
    id: "zoom",
    drift: [0.1, 0.12, 0.12],
    phase: 2.3,
    position: [2.48, 0.62, 0.62],
    pull: [0.1, 0.06],
    scale: 0.8,
    speed: 1.16,
    tilt: [0.14, -0.18, 0.24],
  },
  {
    id: "chatText",
    drift: [0.12, 0.12, 0.08],
    phase: 2.82,
    position: [-1.04, 0.54, 0.76],
    pull: [0.1, 0.06],
    scale: 0.96,
    speed: 1.02,
    tilt: [0.06, 0.08, -0.06],
  },
  {
    id: "notebook",
    drift: [0.1, 0.12, 0.08],
    phase: 3,
    position: [-2.34, -0.34, 0.22],
    pull: [0.12, 0.06],
    scale: 0.92,
    speed: 0.9,
    tilt: [0.08, 0.18, -0.12],
  },
  {
    id: "cup",
    drift: [0.12, 0.12, 0.08],
    phase: 3.1,
    position: [-1.62, -1.34, 0.18],
    pull: [0.12, 0.07],
    scale: 0.9,
    speed: 0.96,
    tilt: [0.18, 0.3, -0.2],
  },
  {
    id: "candy",
    drift: [0.12, 0.1, 0.08],
    phase: 3.68,
    position: [1.08, -0.76, 0.46],
    pull: [0.12, 0.06],
    scale: 0.88,
    speed: 1,
    tilt: [0.12, -0.22, 0.14],
  },
  {
    id: "spider",
    drift: [0.1, 0.14, 0.1],
    phase: 4.15,
    position: [2.16, -1.48, 0.3],
    pull: [0.1, 0.06],
    scale: 0.92,
    speed: 1.04,
    tilt: [0.1, -0.24, 0.16],
  },
  {
    id: "moneyBag",
    drift: [0.1, 0.14, 0.08],
    phase: 4.54,
    position: [-1.86, -2.02, 0.08],
    pull: [0.1, 0.06],
    scale: 0.98,
    speed: 0.88,
    tilt: [0.08, 0.18, -0.1],
  },
  {
    id: "vamp",
    drift: [0.1, 0.12, 0.08],
    phase: 4.82,
    position: [0.46, -2.2, 0.18],
    pull: [0.1, 0.06],
    scale: 0.98,
    speed: 0.84,
    tilt: [0.04, -0.08, 0.06],
  },
  {
    id: "teaCup",
    drift: [0.1, 0.14, 0.08],
    phase: 5.05,
    position: [1.92, -2.36, -0.12],
    pull: [0.1, 0.06],
    scale: 0.98,
    speed: 0.82,
    tilt: [-0.06, 0.1, 0.08],
  },
];

export function SocialOrbitScene({ links }: { links: SocialSceneLink[] }) {
  return (
    <div className="scene-canvas scene-canvas--social">
      <Canvas
        camera={{ fov: 42, position: [0, 0.45, 6.4] }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <SocialOrbitContent links={links} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function SocialOrbitContent({ links }: { links: SocialSceneLink[] }) {
  const texturePaths = useMemo(
    () =>
      Object.fromEntries(
        links.map((link) => [link.id, link.texturePath]),
      ) as Record<SocialSceneLink["id"], string>,
    [links],
  );
  const textures = useTexture(texturePaths) as Record<SocialSceneLink["id"], Texture>;

  useMemo(() => {
    Object.values(textures).forEach((texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
    });
  }, [textures]);

  return (
    <>
      <ambientLight intensity={0.92} />
      <directionalLight
        intensity={1.2}
        position={[3.8, 4.6, 5.6]}
      />
      <pointLight
        color="#bb86ff"
        intensity={14}
        position={[0, 0.35, 2.35]}
      />
      <pointLight
        color="#ff7ad8"
        intensity={5}
        position={[-2.6, 1.4, -1.8]}
      />

      <SceneRig
        height={0.38}
        lookAtY={0.08}
        pointerAmount={0.46}
      />

      <Sparkles
        color="#e7d4ff"
        count={32}
        noise={0.55}
        opacity={0.76}
        scale={[7.2, 4, 6]}
        size={2.6}
        speed={0.36}
      />

      <group>
        <mesh
          position={[0, -0.1, -1.2]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[2.22, 0.024, 16, 120]} />
          <meshBasicMaterial
            color="#d6b7ff"
            opacity={0.24}
            transparent
          />
        </mesh>
        <mesh
          position={[0, -0.05, -1.35]}
          rotation={[Math.PI / 2.3, 0.45, 0.35]}
        >
          <torusGeometry args={[1.58, 0.02, 16, 100]} />
          <meshBasicMaterial
            color="#ff8fe2"
            opacity={0.18}
            transparent
          />
        </mesh>

        <Float
          floatIntensity={0.65}
          rotationIntensity={0.25}
          speed={1.5}
        >
          <mesh
            position={[0, 0.05, 0]}
            scale={1.02}
          >
            <icosahedronGeometry args={[0.88, 1]} />
            <MeshTransmissionMaterial
              anisotropy={0.16}
              backside
              chromaticAberration={0.08}
              color="#bb84ff"
              distortion={0.14}
              distortionScale={0.24}
              ior={1.34}
              resolution={256}
              roughness={0.06}
              samples={4}
              thickness={0.82}
            />
          </mesh>
        </Float>

        {links.map((link, index) => (
          <SocialOrbitToken
            angleOffset={index * ((Math.PI * 2) / Math.max(links.length, 1))}
            key={link.id}
            link={link}
            radius={2.36}
            texture={textures[link.id]}
          />
        ))}
      </group>
    </>
  );
}

function SocialOrbitToken({
  link,
  angleOffset,
  radius,
  texture,
}: {
  link: SocialSceneLink;
  angleOffset: number;
  radius: number;
  texture: Texture;
}) {
  const groupRef = useRef<Group>(null);
  const spriteRef = useRef<ThreeSprite>(null);
  const glowRef = useRef<ThreeMesh>(null);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const accent = socialAccentMap[link.id];

  useFrame((state) => {
    if (!groupRef.current || !spriteRef.current || !glowRef.current) {
      return;
    }

    const elapsed = state.clock.getElapsedTime() * 0.42 + angleOffset;
    groupRef.current.position.set(
      Math.cos(elapsed) * radius,
      Math.sin(elapsed * 1.5) * 0.38,
      Math.sin(elapsed) * radius * 0.78,
    );
    groupRef.current.rotation.x = Math.sin(elapsed * 0.95) * 0.08;
    groupRef.current.rotation.y = -elapsed * 0.28;

    const targetScale = hovered ? 1.9 : 1.62;
    const nextScale = MathUtils.lerp(spriteRef.current.scale.x, targetScale, hovered ? 0.18 : 0.1);
    spriteRef.current.scale.set(nextScale, nextScale, 1);

    const glowScale = hovered ? 1.38 : 1.08;
    glowRef.current.scale.setScalar(
      MathUtils.lerp(glowRef.current.scale.x, glowScale, hovered ? 0.18 : 0.1),
    );
  });

  function handleOpen() {
    window.open(link.href, "_blank", "noopener,noreferrer");
  }

  return (
    <group ref={groupRef}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          handleOpen();
        }}
        onPointerOut={() => setHovered(false)}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        position={[0, 0, -0.08]}
      >
        <circleGeometry args={[0.94, 40]} />
        <meshBasicMaterial
          blending={AdditiveBlending}
          color={accent.glow}
          depthWrite={false}
          opacity={hovered ? 0.22 : 0.12}
          transparent
        />
      </mesh>

      <mesh
        ref={glowRef}
        position={[0, 0, -0.14]}
      >
        <circleGeometry args={[1.16, 40]} />
        <meshBasicMaterial
          color={accent.glow}
          depthWrite={false}
          opacity={0.08}
          transparent
        />
      </mesh>

      <sprite
        ref={spriteRef}
        onClick={(event) => {
          event.stopPropagation();
          handleOpen();
        }}
        onPointerOut={() => setHovered(false)}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        scale={[1.62, 1.62, 1]}
      >
        <spriteMaterial
          alphaTest={0.08}
          depthWrite={false}
          map={texture}
          toneMapped={false}
          transparent
        />
      </sprite>
    </group>
  );
}

export function SuiteSignalScene() {
  return (
    <div className="scene-canvas scene-canvas--executive">
      <Canvas
        camera={{ fov: 44, position: [0, 0.22, 9.3] }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <SuiteSignalContent />
        </Suspense>
      </Canvas>
    </div>
  );
}

function SuiteSignalContent() {
  const textures = useTexture(executiveIconTexturePaths) as Record<ExecutiveSceneIconId, Texture>;

  useMemo(() => {
    Object.values(textures).forEach((texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
    });
  }, [textures]);

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight
        intensity={1.2}
        position={[4.4, 5.2, 6.8]}
      />
      <pointLight
        color="#c387ff"
        intensity={18}
        position={[0.95, 0.85, 3.2]}
      />
      <pointLight
        color="#78c8ff"
        intensity={7}
        position={[-3.2, -1.4, 1.8]}
      />
      <pointLight
        color="#ff8cd8"
        intensity={6}
        position={[3.4, 2.2, -1.6]}
      />

      <SceneRig
        height={0.2}
        lookAtY={0.08}
        pointerAmount={0.22}
      />

      <Sparkles
        color="#f2dcff"
        count={58}
        noise={0.58}
        opacity={0.84}
        scale={[10, 9, 8]}
        size={3.2}
        speed={0.46}
      />

      <ExecutiveIconConstellation textures={textures} />
    </>
  );
}

function ExecutiveIconConstellation({
  textures,
}: {
  textures: Record<ExecutiveSceneIconId, Texture>;
}) {
  const rootRef = useRef<Group>(null);
  const coreRef = useRef<ThreeMesh>(null);

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();

    if (rootRef.current) {
      rootRef.current.rotation.x = MathUtils.lerp(
        rootRef.current.rotation.x,
        -0.02 + state.pointer.y * 0.08 + Math.sin(elapsed * 0.2) * 0.03,
        0.06,
      );
      rootRef.current.rotation.y = MathUtils.lerp(
        rootRef.current.rotation.y,
        state.pointer.x * 0.12 + Math.sin(elapsed * 0.16) * 0.04,
        0.05,
      );
      rootRef.current.rotation.z = MathUtils.lerp(
        rootRef.current.rotation.z,
        -state.pointer.x * 0.04,
        0.06,
      );
      rootRef.current.position.y = MathUtils.lerp(
        rootRef.current.position.y,
        -0.02 + Math.sin(elapsed * 0.46) * 0.05,
        0.05,
      );
    }

    if (coreRef.current) {
      coreRef.current.rotation.x += 0.0032;
      coreRef.current.rotation.y += 0.0038;
      coreRef.current.position.y = MathUtils.lerp(
        coreRef.current.position.y,
        -0.3 + Math.sin(elapsed * 0.74) * 0.06,
        0.05,
      );
    }
  });

  return (
    <>
      <mesh
        position={[0.04, -0.36, -3.08]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1.44, 0.86, 1]}
      >
        <circleGeometry args={[4.18, 64]} />
        <meshBasicMaterial
          color="#6f34ff"
          opacity={0.12}
          transparent
        />
      </mesh>

      <Float
        floatIntensity={0.26}
        rotationIntensity={0.12}
        speed={1.04}
      >
        <mesh
          ref={coreRef}
          position={[0.14, -0.3, -0.82]}
          scale={0.68}
        >
          <icosahedronGeometry args={[0.62, 1]} />
          <MeshTransmissionMaterial
            anisotropy={0.18}
            backside
            chromaticAberration={0.08}
            color="#a96dff"
            distortion={0.08}
            distortionScale={0.18}
            ior={1.3}
            resolution={256}
            roughness={0.04}
            samples={4}
            thickness={0.68}
          />
        </mesh>
      </Float>

      <group ref={rootRef}>
        {executiveTokenConfigs.map((config) => (
          <ExecutiveSceneToken
            config={config}
            key={config.id}
            texture={textures[config.id]}
          />
        ))}
      </group>
    </>
  );
}

function ExecutiveSceneToken({
  config,
  texture,
}: {
  config: ExecutiveSceneTokenConfig;
  texture: Texture;
}) {
  const groupRef = useRef<Group>(null);
  const planeRef = useRef<ThreeMesh>(null);

  useFrame((state) => {
    if (!groupRef.current || !planeRef.current) {
      return;
    }

    const elapsed = state.clock.getElapsedTime() * config.speed + config.phase;
    groupRef.current.position.set(
      config.position[0] + Math.sin(elapsed * 0.92) * config.drift[0] + state.pointer.x * config.pull[0],
      config.position[1] + Math.cos(elapsed * 1.06) * config.drift[1] + state.pointer.y * config.pull[1],
      config.position[2] + Math.sin(elapsed * 0.74) * config.drift[2],
    );

    groupRef.current.rotation.x = MathUtils.lerp(
      groupRef.current.rotation.x,
      config.tilt[0] + state.pointer.y * 0.18,
      0.05,
    );
    groupRef.current.rotation.y = MathUtils.lerp(
      groupRef.current.rotation.y,
      config.tilt[1] - state.pointer.x * 0.22,
      0.05,
    );
    groupRef.current.rotation.z = MathUtils.lerp(
      groupRef.current.rotation.z,
      config.tilt[2] + Math.sin(elapsed * 0.48) * 0.12,
      0.05,
    );

    const scale = config.scale * (1 + Math.sin(elapsed * 1.24) * 0.035);
    planeRef.current.scale.set(scale, scale, 1);
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={planeRef}
        rotation={[0, 0, config.tilt[2] * 0.16]}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          alphaTest={0.04}
          depthWrite={false}
          map={texture}
          side={DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  );
}

function SceneRig({
  height,
  lookAtY,
  pointerAmount,
}: {
  height: number;
  lookAtY: number;
  pointerAmount: number;
}) {
  useFrame((state) => {
    state.camera.position.x = MathUtils.lerp(
      state.camera.position.x,
      state.pointer.x * pointerAmount,
      0.05,
    );
    state.camera.position.y = MathUtils.lerp(
      state.camera.position.y,
      height + state.pointer.y * 0.45,
      0.05,
    );
    state.camera.lookAt(0, lookAtY, 0);
  });

  return null;
}
