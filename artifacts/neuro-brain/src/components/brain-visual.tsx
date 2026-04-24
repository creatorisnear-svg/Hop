import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { useListSynapses } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface BrainVisualProps {
  activeRegion?: string;
  className?: string;
}

const REGION_COLORS: Record<string, number> = {
  jarvis: 0xffffff,
  sensory_cortex: 0x00e5ff,
  association_cortex: 0xff8800,
  hippocampus: 0x00ff88,
  prefrontal_cortex: 0xaa88ff,
  cerebellum: 0x66ff66,
  motor_cortex: 0xff3366,
};

const REGION_LABELS: Record<string, string> = {
  jarvis: "JARVIS",
  sensory_cortex: "SENSORY",
  association_cortex: "ASSOCIATION",
  hippocampus: "HIPPOCAMPUS",
  prefrontal_cortex: "PREFRONTAL",
  cerebellum: "CEREBELLUM",
  motor_cortex: "MOTOR",
};

const REGION_LAYOUT: Record<string, { x: number; y: number; z: number }> = {
  jarvis: { x: 0.0, y: 0.1, z: 0.0 },
  prefrontal_cortex: { x: -0.95, y: 0.95, z: 0.1 },
  motor_cortex: { x: 0.95, y: 0.95, z: 0.1 },
  sensory_cortex: { x: 1.2, y: -0.05, z: 0.4 },
  association_cortex: { x: -1.2, y: -0.05, z: 0.4 },
  hippocampus: { x: -0.6, y: -0.95, z: 0.2 },
  cerebellum: { x: 0.6, y: -0.95, z: 0.2 },
};

// Jarvis is the hub — all regions connect through it.
const CONNECTIONS: [string, string][] = [
  ["jarvis", "sensory_cortex"],
  ["jarvis", "association_cortex"],
  ["jarvis", "hippocampus"],
  ["jarvis", "prefrontal_cortex"],
  ["jarvis", "cerebellum"],
  ["jarvis", "motor_cortex"],
  ["sensory_cortex", "association_cortex"],
  ["association_cortex", "prefrontal_cortex"],
  ["prefrontal_cortex", "cerebellum"],
  ["prefrontal_cortex", "motor_cortex"],
  ["hippocampus", "prefrontal_cortex"],
];

/**
 * Build a distinctive 3D mesh per region. Each region is a small "organ"
 * made of three layers:
 *  - core: a solid emissive mesh whose intensity & scale react to activity
 *  - wire: a slightly larger wireframe shell that spins
 *  - halo: a billboard sprite that pulses outward with activity
 */
function buildRegionGeometry(key: string): THREE.BufferGeometry {
  switch (key) {
    case "jarvis":
      // Central hub — high-detail icosahedron, reads as a glowing brain core.
      return new THREE.IcosahedronGeometry(0.42, 2);
    case "prefrontal_cortex":
      // Executive function — clean faceted dodecahedron.
      return new THREE.DodecahedronGeometry(0.32, 0);
    case "motor_cortex":
      // Action — sharp octahedron.
      return new THREE.OctahedronGeometry(0.34, 0);
    case "sensory_cortex":
      // Intricate sensory input — torus knot.
      return new THREE.TorusKnotGeometry(0.22, 0.07, 96, 12, 2, 3);
    case "association_cortex":
      // Broad connectivity — high-detail icosahedron displaced.
      return new THREE.IcosahedronGeometry(0.32, 1);
    case "hippocampus":
      // Memory loop — torus.
      return new THREE.TorusGeometry(0.24, 0.08, 16, 48);
    case "cerebellum":
      // Folded folia — twisted torus knot, denser windings.
      return new THREE.TorusKnotGeometry(0.22, 0.05, 128, 12, 4, 5);
    default:
      return new THREE.SphereGeometry(0.3, 24, 24);
  }
}

function createNeuronTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,0.8)");
  g.addColorStop(0.4, "rgba(255,255,255,0.3)");
  g.addColorStop(0.7, "rgba(255,255,255,0.05)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createHaloTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;
  const g = ctx.createRadialGradient(half, half, half * 0.05, half, half, half);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.25, "rgba(255,255,255,0.45)");
  g.addColorStop(0.55, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

interface Signal {
  active: boolean;
  from: THREE.Vector3;
  mid: THREE.Vector3;
  to: THREE.Vector3;
  pos: THREE.Vector3;
  progress: number;
  speed: number;
  color: THREE.Color;
}

export function BrainVisual({ activeRegion, className }: BrainVisualProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const activeRegionRef = useRef<string | undefined>(activeRegion);
  // Tracks when each region last fired (performance.now ms) — used so multiple
  // recently-active regions all glow, fading over a few seconds.
  const lastActiveAtRef = useRef<Record<string, number>>({});
  const lastSpawnRef = useRef<number>(0);
  const focusTargetRef = useRef<string | null>(null);
  // Map of "from->to" -> learned synapse strength (0..1). Read live by the
  // animation loop to weight edge brightness and pulse-spawning probability.
  const synStrengthRef = useRef<Record<string, number>>({});
  // Set inside the three.js mount effect; lets the synapses effect inject
  // brand-new edges into the scene as the brain learns them in real time.
  const addEdgeRef = useRef<((a: string, b: string) => void) | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  // Pull learned synapse strengths from the backend; refresh while a run is
  // active so newly reinforced pathways light up without a page reload.
  const { data: synapsesData } = useListSynapses({
    query: { refetchInterval: activeRegion ? 2500 : 15000 },
  });
  useEffect(() => {
    const map: Record<string, number> = {};
    for (const s of synapsesData ?? []) {
      map[`${s.fromRegion}->${s.toRegion}`] = s.strength;
    }
    synStrengthRef.current = map;
    // Inject any new pairs into the live scene so freshly-learned synapses
    // appear as actual geometry without needing a reload.
    const add = addEdgeRef.current;
    if (add) {
      for (const s of synapsesData ?? []) {
        add(s.fromRegion, s.toRegion);
      }
    }
  }, [synapsesData]);

  // keep the latest activeRegion accessible inside the animation loop
  useEffect(() => {
    activeRegionRef.current = activeRegion;
    if (activeRegion) {
      lastActiveAtRef.current[activeRegion] = performance.now();
    }
  }, [activeRegion]);

  useEffect(() => {
    const container = containerRef.current;
    const labelLayer = labelLayerRef.current;
    if (!container || !labelLayer) return;

    let width = container.clientWidth;
    let height = container.clientHeight;
    if (width === 0 || height === 0) {
      width = 300;
      height = 300;
    }

    const isMobile = Math.min(width, height) < 480;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(
      isMobile ? 62 : 55,
      width / height,
      0.01,
      100,
    );
    camera.position.set(0, 0.25, isMobile ? 4.4 : 3.8);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
    } catch (err) {
      console.warn("[BrainVisual] WebGL unavailable, falling back to 2D", err);
      setWebglFailed(true);
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none"; // prevent page-scroll while orbiting on mobile

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      isMobile ? 0.55 : 0.75,
      0.4,
      0.18,
    );
    composer.addPass(bloom);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = isMobile ? 0.7 : 0.5;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.zoomSpeed = isMobile ? 0.7 : 0.9;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.target.set(0, 0.05, 0);
    controls.minDistance = isMobile ? 2.8 : 2.4;
    controls.maxDistance = isMobile ? 8 : 7;

    // Lighting — ambient + a couple of directional rims so the 3D meshes
    // actually read as solids rather than flat silhouettes.
    scene.add(new THREE.AmbientLight(0x223355, 0.55));
    const keyLight = new THREE.DirectionalLight(0x88aaff, 0.6);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xff88aa, 0.35);
    rimLight.position.set(-3, -1, -2);
    scene.add(rimLight);
    const centerLight = new THREE.PointLight(0x3355aa, 1.0, 8);
    centerLight.position.set(0, 0.2, 0);
    scene.add(centerLight);

    const neuronTex = createNeuronTexture();
    const haloTex = createHaloTexture();

    // Build a 3D model per region (core + wire + halo + label).
    type RegionRefs = {
      group: THREE.Group;
      core: THREE.Mesh;
      coreMat: THREE.MeshStandardMaterial;
      wire: THREE.LineSegments;
      wireMat: THREE.LineBasicMaterial;
      halo: THREE.Sprite;
      haloMat: THREE.SpriteMaterial;
      labelEl: HTMLDivElement;
      activity: number; // 0..1, eased toward target each frame
      baseScale: number;
      spinAxis: THREE.Vector3;
      spinSpeed: number;
    };
    const regionRefs: Record<string, RegionRefs> = {};

    for (const [key, layout] of Object.entries(REGION_LAYOUT)) {
      const colorHex = REGION_COLORS[key] ?? 0xffffff;
      const color = new THREE.Color(colorHex);
      const isHub = key === "jarvis";

      const group = new THREE.Group();
      group.position.set(layout.x, layout.y, layout.z);
      scene.add(group);

      // Core solid mesh — emissive so it glows through the bloom pass.
      const geom = buildRegionGeometry(key);
      const coreMat = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.35),
        emissive: color.clone(),
        emissiveIntensity: isHub ? 0.9 : 0.55,
        metalness: 0.4,
        roughness: 0.35,
        flatShading: key === "prefrontal_cortex" || key === "motor_cortex",
        transparent: true,
        opacity: 0.92,
      });
      const core = new THREE.Mesh(geom, coreMat);
      group.add(core);

      // Wireframe shell — slightly larger, spins independently for life.
      const wireGeom = new THREE.WireframeGeometry(geom);
      const wireMat = new THREE.LineBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const wire = new THREE.LineSegments(wireGeom, wireMat);
      wire.scale.setScalar(1.18);
      group.add(wire);

      // Halo billboard — fades up while the region is active.
      const haloMat = new THREE.SpriteMaterial({
        map: haloTex,
        color: color.clone(),
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(isHub ? 1.6 : 1.2);
      group.add(halo);

      // Per-region spin axis so each model rotates with its own personality.
      const spinAxis = new THREE.Vector3(
        Math.sin(key.length * 1.13),
        Math.cos(key.length * 0.71),
        Math.sin(key.length * 0.47),
      ).normalize();
      const spinSpeed = isHub ? 0.18 : 0.25 + (key.charCodeAt(0) % 5) * 0.04;

      // DOM label
      const labelEl = document.createElement("div");
      const colorCss = "#" + colorHex.toString(16).padStart(6, "0");
      labelEl.textContent = REGION_LABELS[key] ?? key;
      labelEl.dataset.regionKey = key;
      labelEl.style.cssText = `
        position: absolute;
        pointer-events: auto;
        cursor: pointer;
        user-select: none;
        font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
        font-size: ${isMobile ? 10 : 9}px;
        letter-spacing: 1.5px;
        padding: 2px 6px;
        background: rgba(0,0,0,0.55);
        color: ${colorCss};
        border: 1px solid ${colorCss}40;
        border-radius: 3px;
        backdrop-filter: blur(4px);
        white-space: nowrap;
        transform: translate(-50%, -100%);
        transition: opacity 0.2s, background 0.2s, border-color 0.2s, transform 0.2s;
        will-change: transform, left, top;
      `;
      const onEnter = () => {
        labelEl.style.background = "rgba(0,0,0,0.8)";
        labelEl.style.borderColor = colorCss;
      };
      const onLeave = () => {
        labelEl.style.background = "rgba(0,0,0,0.55)";
        labelEl.style.borderColor = colorCss + "40";
      };
      labelEl.addEventListener("mouseenter", onEnter);
      labelEl.addEventListener("mouseleave", onLeave);
      labelEl.addEventListener("click", (e) => {
        e.stopPropagation();
        focusTargetRef.current = key;
        controls.autoRotate = false;
        // Mark a small "ping" of activity so the user sees feedback
        lastActiveAtRef.current[key] = performance.now();
      });
      labelLayer.appendChild(labelEl);

      regionRefs[key] = {
        group,
        core,
        coreMat,
        wire,
        wireMat,
        halo,
        haloMat,
        labelEl,
        activity: 0,
        baseScale: isHub ? 1.15 : 0.95,
        spinAxis,
        spinSpeed,
      };
      group.scale.setScalar(regionRefs[key].baseScale);
    }

    // Connection lines: always include the hardcoded topology, plus add an
    // edge for any learned synapse pair we don't already have. Each edge is
    // tagged with its (from,to) keys so the animation loop can look up the
    // current learned strength and modulate brightness/color in real time.
    type EdgeRef = {
      from: string;
      to: string;
      mat: THREE.LineBasicMaterial;
      baseColor: THREE.Color;
      hotColor: THREE.Color;
      bornAt: number;       // performance.now() when added — drives birth flash
      announced: boolean;   // becomes true after the birth pulse-burst is spawned
    };
    const lineGroup = new THREE.Group();
    const edgeRefs: EdgeRef[] = [];
    const seenEdges = new Set<string>();
    const baseEdgeColor = new THREE.Color(0x335577);
    const hotEdgeColor = new THREE.Color(0xffb347);

    // Track first-mount so we don't fire a "newly born" flash for the
    // initial set of edges — only edges that appear later count as new.
    let initialMount = true;

    function addEdge(a: string, b: string) {
      const la = REGION_LAYOUT[a];
      const lb = REGION_LAYOUT[b];
      if (!la || !lb) return;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(la.x, la.y, la.z),
        new THREE.Vector3(lb.x, lb.y, lb.z),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: baseEdgeColor.clone(),
        transparent: true,
        // Edges born after the initial mount start invisible and fade in.
        opacity: initialMount ? 0.22 : 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      lineGroup.add(new THREE.Line(geo, mat));
      edgeRefs.push({
        from: a,
        to: b,
        mat,
        baseColor: baseEdgeColor,
        hotColor: hotEdgeColor,
        bornAt: initialMount ? -Infinity : performance.now(),
        announced: initialMount,
      });
    }
    for (const [a, b] of CONNECTIONS) addEdge(a, b);
    for (const key of Object.keys(synStrengthRef.current)) {
      const [a, b] = key.split("->");
      if (a && b) addEdge(a, b);
    }
    scene.add(lineGroup);
    // Anything added from now on is a real, freshly-learned synapse.
    initialMount = false;

    // Expose addEdge so the synapses effect can inject newly-learned pairs
    // into the live scene without a remount.
    addEdgeRef.current = addEdge;

    function edgeStrength(a: string, b: string): number {
      const m = synStrengthRef.current;
      return Math.max(m[`${a}->${b}`] ?? 0, m[`${b}->${a}`] ?? 0);
    }

    // Signal particles — synaptic pulses traveling along edges.
    const MAX_SIGNALS = 80;
    const signals: Signal[] = [];
    for (let i = 0; i < MAX_SIGNALS; i++) {
      signals.push({
        active: false,
        from: new THREE.Vector3(),
        mid: new THREE.Vector3(),
        to: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        progress: 0,
        speed: 0,
        color: new THREE.Color(),
      });
    }
    const sigGeo = new THREE.BufferGeometry();
    const sigPos = new Float32Array(MAX_SIGNALS * 3);
    const sigCol = new Float32Array(MAX_SIGNALS * 3);
    for (let i = 0; i < MAX_SIGNALS; i++) {
      sigPos[i * 3 + 1] = -100;
    }
    sigGeo.setAttribute("position", new THREE.BufferAttribute(sigPos, 3));
    sigGeo.setAttribute("color", new THREE.BufferAttribute(sigCol, 3));
    const sigMat = new THREE.PointsMaterial({
      size: 0.06,
      map: neuronTex,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      vertexColors: true,
    });
    const sigMesh = new THREE.Points(sigGeo, sigMat);
    scene.add(sigMesh);

    function spawnSignal(fromKey: string, toKey: string, colorHex: number) {
      const from = REGION_LAYOUT[fromKey];
      const to = REGION_LAYOUT[toKey];
      if (!from || !to) return;
      for (const s of signals) {
        if (s.active) continue;
        s.active = true;
        s.from.set(from.x, from.y, from.z);
        s.to.set(to.x, to.y, to.z);
        s.pos.copy(s.from);
        s.progress = 0;
        s.speed = 0.6 + Math.random() * 0.7;
        s.color.set(colorHex);
        s.mid.set(
          (from.x + to.x) / 2 + (Math.random() - 0.5) * 0.35,
          (from.y + to.y) / 2 + (Math.random() - 0.5) * 0.35,
          (from.z + to.z) / 2 + (Math.random() - 0.5) * 0.35,
        );
        return;
      }
    }

    // Animation loop
    const clock = new THREE.Clock();
    let raf = 0;
    let mounted = true;
    let timeAcc = 0;

    function animate() {
      if (!mounted) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      timeAcc += dt;

      // Drive activity from a TRAIL of recently-active regions.
      const active = activeRegionRef.current;
      const now = performance.now();
      const TRAIL_HOLD_MS = 2200;
      const TRAIL_FADE_MS = 6000;

      for (const [key, r] of Object.entries(regionRefs)) {
        const lastAt = lastActiveAtRef.current[key] ?? -Infinity;
        const sinceMs = now - lastAt;
        let trail = 0;
        if (sinceMs <= TRAIL_HOLD_MS) {
          trail = 1;
        } else if (sinceMs < TRAIL_FADE_MS) {
          trail =
            1 - (sinceMs - TRAIL_HOLD_MS) / (TRAIL_FADE_MS - TRAIL_HOLD_MS);
        }
        const target = key === active ? 1 : Math.max(0.05, trail);
        r.activity += (target - r.activity) * Math.min(1, dt * 3);

        const breathe = 0.92 + Math.sin(timeAcc * 1.6 + key.length) * 0.08;

        // Core: emissive intensity + scale react to activity.
        r.coreMat.emissiveIntensity = (0.35 + r.activity * 1.4) * breathe;
        r.coreMat.opacity = 0.65 + r.activity * 0.35;

        // Wire: brighter + faster spin when active.
        r.wireMat.opacity = 0.18 + r.activity * 0.55;

        // Halo: blooms outward with activity.
        r.haloMat.opacity = r.activity * 0.85;
        const haloScale =
          (key === "jarvis" ? 1.6 : 1.2) * (1 + r.activity * 0.45);
        r.halo.scale.setScalar(haloScale);

        // Group scale pulses gently while active.
        const s =
          r.baseScale *
          (1 + r.activity * 0.18 + Math.sin(timeAcc * 3 + key.length) * 0.02);
        r.group.scale.setScalar(s);

        // Spin: independent per region, faster when firing.
        const spin = r.spinSpeed * (0.6 + r.activity * 1.8);
        r.core.rotateOnAxis(r.spinAxis, spin * dt);
        r.wire.rotateOnAxis(r.spinAxis, -spin * 1.4 * dt);
      }

      // Animate edge brightness from learned synapse strength + birth flash.
      const BIRTH_FLASH_MS = 1600;
      for (const e of edgeRefs) {
        const strength = edgeStrength(e.from, e.to);
        const isActiveEdge = active === e.from || active === e.to;
        const breathe = 0.85 + Math.sin(timeAcc * 2 + e.from.length) * 0.15;
        const sinceBirth = now - e.bornAt;
        let birth = 0;
        if (sinceBirth >= 0 && sinceBirth < BIRTH_FLASH_MS) {
          birth = 1 - sinceBirth / BIRTH_FLASH_MS; // 1 → 0 over the flash window
        }
        const targetOpacity =
          (0.18 + strength * 0.55 + (isActiveEdge ? 0.25 : 0) + birth * 0.85) *
          breathe;
        e.mat.opacity += (targetOpacity - e.mat.opacity) * Math.min(1, dt * 5);
        // While being born, override toward bright white so it pops, then
        // settle back into the cool→hot gradient driven by strength.
        if (birth > 0.01) {
          const target = new THREE.Color(0xffffff)
            .lerp(e.hotColor, 1 - birth)
            .lerp(e.baseColor, (1 - birth) * 0.4);
          e.mat.color.copy(target);
        } else {
          e.mat.color.copy(e.baseColor).lerp(e.hotColor, Math.min(1, strength));
        }

        // First time we see a brand-new edge in the loop, fire a burst of
        // signals running back and forth along it so the user sees the
        // synapse "wire itself up" rather than just appearing.
        if (!e.announced && sinceBirth >= 0) {
          e.announced = true;
          const colorA = REGION_COLORS[e.from] ?? 0xffffff;
          const colorB = REGION_COLORS[e.to] ?? 0xffffff;
          for (let i = 0; i < 4; i++) {
            spawnSignal(e.from, e.to, colorA);
            spawnSignal(e.to, e.from, colorB);
          }
        }
      }

      // Spawn signals along the active region's connections.
      if (active && timeAcc - lastSpawnRef.current > 0.05) {
        lastSpawnRef.current = timeAcc;
        const color = REGION_COLORS[active] ?? 0xffffff;
        const peers = edgeRefs
          .filter((e) => e.from === active || e.to === active)
          .map((e) => {
            const other = e.from === active ? e.to : e.from;
            const w = 0.3 + edgeStrength(e.from, e.to) * 0.9;
            return { other, w };
          });
        if (peers.length > 0 && Math.random() < 0.7) {
          const totalW = peers.reduce((sum, p) => sum + p.w, 0);
          let pick = Math.random() * totalW;
          let chosen = peers[0];
          for (const p of peers) {
            pick -= p.w;
            if (pick <= 0) {
              chosen = p;
              break;
            }
          }
          if (Math.random() < 0.7) {
            spawnSignal(active, chosen.other, color);
          } else {
            spawnSignal(
              chosen.other,
              active,
              REGION_COLORS[chosen.other] ?? color,
            );
          }
        }
      }

      // Update signals
      for (let i = 0; i < MAX_SIGNALS; i++) {
        const s = signals[i];
        if (!s.active) {
          sigPos[i * 3 + 1] = -100;
          continue;
        }
        s.progress += dt * s.speed;
        if (s.progress >= 1) {
          s.active = false;
          sigPos[i * 3 + 1] = -100;
          continue;
        }
        const t = s.progress;
        const t1 = 1 - t;
        s.pos.x = t1 * t1 * s.from.x + 2 * t1 * t * s.mid.x + t * t * s.to.x;
        s.pos.y = t1 * t1 * s.from.y + 2 * t1 * t * s.mid.y + t * t * s.to.y;
        s.pos.z = t1 * t1 * s.from.z + 2 * t1 * t * s.mid.z + t * t * s.to.z;
        sigPos[i * 3] = s.pos.x;
        sigPos[i * 3 + 1] = s.pos.y;
        sigPos[i * 3 + 2] = s.pos.z;
        sigCol[i * 3] = s.color.r;
        sigCol[i * 3 + 1] = s.color.g;
        sigCol[i * 3 + 2] = s.color.b;
      }
      sigGeo.attributes.position.needsUpdate = true;
      sigGeo.attributes.color.needsUpdate = true;

      // Update label positions in DOM
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      const v = new THREE.Vector3();
      for (const [key, r] of Object.entries(regionRefs)) {
        const layout = REGION_LAYOUT[key];
        v.set(layout.x, layout.y + 0.55, layout.z);
        v.project(camera);
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h;
        if (v.z > 1) {
          r.labelEl.style.opacity = "0";
        } else {
          r.labelEl.style.left = `${x}px`;
          r.labelEl.style.top = `${y}px`;
          const dist = camera.position.distanceTo(
            new THREE.Vector3(layout.x, layout.y, layout.z),
          );
          const op = Math.max(0.3, Math.min(1, 1 - (dist - 2.5) / 4));
          r.labelEl.style.opacity = String(op);
        }
      }

      // Smooth camera focus when a label is clicked
      const focusKey = focusTargetRef.current;
      if (focusKey) {
        const layout = REGION_LAYOUT[focusKey];
        if (layout) {
          const tx = layout.x;
          const ty = layout.y + 0.05;
          const tz = layout.z;
          controls.target.x += (tx - controls.target.x) * Math.min(1, dt * 2.5);
          controls.target.y += (ty - controls.target.y) * Math.min(1, dt * 2.5);
          controls.target.z += (tz - controls.target.z) * Math.min(1, dt * 2.5);
          const desiredDist = isMobile ? 3.0 : 2.6;
          const dir = new THREE.Vector3()
            .subVectors(camera.position, controls.target)
            .normalize();
          const targetCam = new THREE.Vector3()
            .copy(controls.target)
            .addScaledVector(dir, desiredDist);
          camera.position.x +=
            (targetCam.x - camera.position.x) * Math.min(1, dt * 2.5);
          camera.position.y +=
            (targetCam.y - camera.position.y) * Math.min(1, dt * 2.5);
          camera.position.z +=
            (targetCam.z - camera.position.z) * Math.min(1, dt * 2.5);
        }
      }

      controls.update();
      composer.render();
    }
    animate();

    const onDblClick = () => {
      focusTargetRef.current = null;
      controls.autoRotate = true;
    };
    renderer.domElement.addEventListener("dblclick", onDblClick);

    // Resize observer — keeps the scene fluid on rotate / window resize.
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, entry.contentRect.width);
        const h = Math.max(1, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        composer.setSize(w, h);
      }
    });
    ro.observe(container);

    return () => {
      mounted = false;
      addEdgeRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      controls.dispose();
      for (const r of Object.values(regionRefs)) {
        r.core.geometry.dispose();
        r.coreMat.dispose();
        r.wire.geometry.dispose();
        r.wireMat.dispose();
        r.haloMat.dispose();
        r.labelEl.remove();
      }
      lineGroup.children.forEach((c) => {
        const line = c as THREE.Line;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      sigGeo.dispose();
      sigMat.dispose();
      neuronTex.dispose();
      haloTex.dispose();
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (webglFailed) {
    return <BrainVisualFallback activeRegion={activeRegion} className={className} />;
  }

  return (
    <div
      className={cn(
        "relative w-full h-full min-h-[260px] overflow-hidden rounded-lg",
        className,
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <div
        ref={labelLayerRef}
        className="pointer-events-none absolute inset-0"
      />
    </div>
  );
}

function BrainVisualFallback({ activeRegion, className }: BrainVisualProps) {
  const nodes = [
    { key: "jarvis", label: "JARVIS", x: 50, y: 50 },
    { key: "prefrontal_cortex", label: "PFC", x: 22, y: 22 },
    { key: "motor_cortex", label: "MC", x: 78, y: 22 },
    { key: "sensory_cortex", label: "SC", x: 92, y: 50 },
    { key: "association_cortex", label: "AC", x: 8, y: 50 },
    { key: "hippocampus", label: "HC", x: 25, y: 82 },
    { key: "cerebellum", label: "CB", x: 75, y: 82 },
  ];
  const edges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
    [4, 1], [3, 2], [1, 5], [2, 6], [5, 6],
  ];
  return (
    <div
      className={cn(
        "relative w-full h-full min-h-[260px] overflow-hidden rounded-lg bg-black/40",
        className,
      )}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
        {edges.map(([i, j], idx) => {
          const a = nodes[i];
          const b = nodes[j];
          const active = activeRegion === a.key || activeRegion === b.key;
          return (
            <line
              key={idx}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              strokeWidth="0.5"
              className={cn(
                "transition-all duration-500",
                active ? "text-accent opacity-80" : "text-primary/20",
              )}
            />
          );
        })}
      </svg>
      {nodes.map((n) => {
        const active = activeRegion === n.key;
        return (
          <div
            key={n.key}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
          >
            <div
              className={cn(
                "h-3 w-3 rounded-full transition-all",
                active
                  ? "bg-accent shadow-[0_0_12px_hsl(var(--accent))] scale-150"
                  : "bg-primary/60",
              )}
            />
            <span className="mt-1 text-[9px] tracking-widest text-muted-foreground">
              {n.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
