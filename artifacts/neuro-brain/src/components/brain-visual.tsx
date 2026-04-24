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
  prefrontal_cortex: { x: -0.85, y: 0.9, z: 0.1 },
  motor_cortex: { x: 0.85, y: 0.9, z: 0.1 },
  sensory_cortex: { x: 1.1, y: -0.05, z: 0.4 },
  association_cortex: { x: -1.1, y: -0.05, z: 0.4 },
  hippocampus: { x: -0.55, y: -0.85, z: 0.2 },
  cerebellum: { x: 0.55, y: -0.85, z: 0.2 },
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

function generateRegionPoints(count: number, radius: number): Float32Array {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Random point in sphere via rejection-free method
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * Math.cbrt(Math.random());
    arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    arr[i * 3 + 2] = r * Math.cos(phi);
  }
  return arr;
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
  const [webglFailed, setWebglFailed] = useState(false);

  // Pull learned synapse strengths from the backend; refresh while a run is
  // active so newly reinforced pathways light up without a page reload.
  const { data: synapsesData } = useListSynapses({
    query: { refetchInterval: activeRegion ? 4000 : 30000 },
  });
  useEffect(() => {
    const map: Record<string, number> = {};
    for (const s of synapsesData ?? []) {
      map[`${s.fromRegion}->${s.toRegion}`] = s.strength;
    }
    synStrengthRef.current = map;
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

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.01, 100);
    camera.position.set(0, 0.2, 3.6);

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
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.7,
      0.4,
      0.2,
    );
    composer.addPass(bloom);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    controls.target.set(0, 0.05, 0);
    controls.minDistance = 2.4;
    controls.maxDistance = 7;

    scene.add(new THREE.AmbientLight(0x223355, 0.5));
    const centerLight = new THREE.PointLight(0x3355aa, 0.8, 8);
    centerLight.position.set(0, 0.2, 0);
    scene.add(centerLight);

    const neuronTex = createNeuronTexture();

    // Build neurons + glow per region
    type RegionRefs = {
      base: Float32Array;
      points: THREE.Points;
      glow: THREE.Points;
      labelEl: HTMLDivElement;
      activity: number; // 0..1, decays over time
    };
    const regionRefs: Record<string, RegionRefs> = {};

    for (const [key, layout] of Object.entries(REGION_LAYOUT)) {
      const color = REGION_COLORS[key] ?? 0xffffff;
      const isHub = key === "jarvis";
      const count = isHub ? 380 : 220;
      const localPts = generateRegionPoints(count, isHub ? 0.22 : 0.32);
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = localPts[i * 3] + layout.x;
        positions[i * 3 + 1] = localPts[i * 3 + 1] + layout.y;
        positions[i * 3 + 2] = localPts[i * 3 + 2] + layout.z;
      }
      const base = new Float32Array(positions);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color,
        size: 0.025,
        map: neuronTex,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geom, mat);
      scene.add(points);

      const glowGeom = geom.clone();
      const glowMat = new THREE.PointsMaterial({
        color,
        size: 0.07,
        map: neuronTex,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const glow = new THREE.Points(glowGeom, glowMat);
      scene.add(glow);

      // Label
      const labelEl = document.createElement("div");
      const colorHex = "#" + color.toString(16).padStart(6, "0");
      labelEl.textContent = REGION_LABELS[key] ?? key;
      labelEl.dataset.regionKey = key;
      labelEl.style.cssText = `
        position: absolute;
        pointer-events: auto;
        cursor: pointer;
        user-select: none;
        font-family: ui-monospace, "JetBrains Mono", Consolas, monospace;
        font-size: 9px;
        letter-spacing: 1.5px;
        padding: 2px 6px;
        background: rgba(0,0,0,0.45);
        color: ${colorHex};
        border: 1px solid ${colorHex}40;
        border-radius: 3px;
        backdrop-filter: blur(4px);
        white-space: nowrap;
        transform: translate(-50%, -100%);
        transition: opacity 0.2s, background 0.2s, border-color 0.2s, transform 0.2s;
        will-change: transform, left, top;
      `;
      labelEl.addEventListener("mouseenter", () => {
        labelEl.style.background = "rgba(0,0,0,0.75)";
        labelEl.style.borderColor = colorHex;
      });
      labelEl.addEventListener("mouseleave", () => {
        labelEl.style.background = "rgba(0,0,0,0.45)";
        labelEl.style.borderColor = colorHex + "40";
      });
      labelEl.addEventListener("click", (e) => {
        e.stopPropagation();
        focusTargetRef.current = key;
        controls.autoRotate = false;
        // Mark a small "ping" of activity so the user sees feedback
        lastActiveAtRef.current[key] = performance.now();
      });
      labelLayer.appendChild(labelEl);

      regionRefs[key] = { base, points, glow, labelEl, activity: 0 };
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
    };
    const lineGroup = new THREE.Group();
    const edgeRefs: EdgeRef[] = [];
    const seenEdges = new Set<string>();
    const baseColor = new THREE.Color(0x335577);
    const hotColor = new THREE.Color(0xffb347); // warm amber for strong pathways

    function addEdge(a: string, b: string) {
      const la = REGION_LAYOUT[a];
      const lb = REGION_LAYOUT[b];
      if (!la || !lb) return;
      // Treat edges as undirected for visualization
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(la.x, la.y, la.z),
        new THREE.Vector3(lb.x, lb.y, lb.z),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: baseColor.clone(),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
      });
      lineGroup.add(new THREE.Line(geo, mat));
      edgeRefs.push({ from: a, to: b, mat, baseColor, hotColor });
    }
    for (const [a, b] of CONNECTIONS) addEdge(a, b);
    // Pull in any learned pairs already known at mount time so they appear
    // immediately. (Pairs learned later still light up the matching base edge
    // via the animation loop, but won't add new geometry post-mount.)
    for (const key of Object.keys(synStrengthRef.current)) {
      const [a, b] = key.split("->");
      if (a && b) addEdge(a, b);
    }
    scene.add(lineGroup);

    // Look up undirected learned strength for an edge (max of either direction)
    function edgeStrength(a: string, b: string): number {
      const m = synStrengthRef.current;
      return Math.max(m[`${a}->${b}`] ?? 0, m[`${b}->${a}`] ?? 0);
    }

    // Signal particles
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
      sigPos[i * 3 + 1] = -100; // hide
    }
    sigGeo.setAttribute("position", new THREE.BufferAttribute(sigPos, 3));
    sigGeo.setAttribute("color", new THREE.BufferAttribute(sigCol, 3));
    const sigMat = new THREE.PointsMaterial({
      size: 0.045,
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

      // Drive activity from a TRAIL of recently-active regions, so when the
      // brain cycles through SC -> AC -> HC -> PFC -> ... each one keeps glowing
      // for a few seconds before fading.
      const active = activeRegionRef.current;
      const now = performance.now();
      const TRAIL_HOLD_MS = 2200;   // full intensity for this long after firing
      const TRAIL_FADE_MS = 6000;   // total decay window
      for (const [key, r] of Object.entries(regionRefs)) {
        const lastAt = lastActiveAtRef.current[key] ?? -Infinity;
        const sinceMs = now - lastAt;
        let trail = 0;
        if (sinceMs <= TRAIL_HOLD_MS) {
          trail = 1;
        } else if (sinceMs < TRAIL_FADE_MS) {
          trail = 1 - (sinceMs - TRAIL_HOLD_MS) / (TRAIL_FADE_MS - TRAIL_HOLD_MS);
        }
        // The currently-active region is pinned to 1; others use trail
        const target = key === active ? 1 : Math.max(0.05, trail);
        // ease toward target
        r.activity += (target - r.activity) * Math.min(1, dt * 3);

        const phase = timeAcc * 1.4 + key.length * 0.4;
        const pulse = Math.sin(phase) * 0.12 + 0.9;
        r.points.material.opacity = (0.45 + r.activity * 0.5) * pulse;
        r.points.material.size = 0.022 + r.activity * 0.018;
        r.glow.material.opacity = (0.12 + r.activity * 0.35) * pulse;
        r.glow.material.size = 0.06 + r.activity * 0.06;

        // Jitter when active
        if (r.activity > 0.15) {
          const arr = r.points.geometry.attributes.position.array as Float32Array;
          const base = r.base;
          const jit = Math.min(r.activity * 0.04, 0.025);
          const stride = 3 * 3; // every 3rd point per frame
          for (let i = 0; i < arr.length; i += stride) {
            arr[i] = base[i] + (Math.random() - 0.5) * jit;
            arr[i + 1] = base[i + 1] + (Math.random() - 0.5) * jit;
            arr[i + 2] = base[i + 2] + (Math.random() - 0.5) * jit;
          }
          r.points.geometry.attributes.position.needsUpdate = true;
        }
      }

      // Animate edge brightness from learned synapse strength so pathways the
      // brain actually uses glow brighter than dormant ones.
      for (const e of edgeRefs) {
        const strength = edgeStrength(e.from, e.to); // 0..1
        const isActiveEdge = active === e.from || active === e.to;
        // Subtle breathing for hot edges
        const breathe = 0.85 + Math.sin(timeAcc * 2 + e.from.length) * 0.15;
        const targetOpacity =
          (0.18 + strength * 0.55 + (isActiveEdge ? 0.2 : 0)) * breathe;
        e.mat.opacity += (targetOpacity - e.mat.opacity) * Math.min(1, dt * 4);
        // Lerp color from cool baseline to warm amber as strength grows
        e.mat.color.copy(e.baseColor).lerp(e.hotColor, Math.min(1, strength));
      }

      // Spawn signals from / to active region along its connections, biased
      // toward pathways with higher learned strength.
      if (active && timeAcc - lastSpawnRef.current > 0.05) {
        lastSpawnRef.current = timeAcc;
        const color = REGION_COLORS[active] ?? 0xffffff;
        // Build weighted peer list from any edge touching the active region.
        const peers = edgeRefs
          .filter((e) => e.from === active || e.to === active)
          .map((e) => {
            const other = e.from === active ? e.to : e.from;
            const w = 0.3 + edgeStrength(e.from, e.to) * 0.9; // 0.3..1.2
            return { other, w };
          });
        if (peers.length > 0 && Math.random() < 0.7) {
          const totalW = peers.reduce((s, p) => s + p.w, 0);
          let pick = Math.random() * totalW;
          let chosen = peers[0];
          for (const p of peers) {
            pick -= p.w;
            if (pick <= 0) {
              chosen = p;
              break;
            }
          }
          // direction: outgoing from active most of the time
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
        v.set(layout.x, layout.y + 0.35, layout.z);
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
          const op = Math.max(0.25, Math.min(1, 1 - (dist - 2.5) / 4));
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
          // Pull the camera in a bit toward this region
          const desiredDist = 2.6;
          const dir = new THREE.Vector3()
            .subVectors(camera.position, controls.target)
            .normalize();
          const targetCam = new THREE.Vector3()
            .copy(controls.target)
            .addScaledVector(dir, desiredDist);
          camera.position.x += (targetCam.x - camera.position.x) * Math.min(1, dt * 2.5);
          camera.position.y += (targetCam.y - camera.position.y) * Math.min(1, dt * 2.5);
          camera.position.z += (targetCam.z - camera.position.z) * Math.min(1, dt * 2.5);
        }
      }

      controls.update();
      composer.render();
    }
    animate();

    // Double-click on empty canvas: reset focus + resume auto-rotate
    const onDblClick = () => {
      focusTargetRef.current = null;
      controls.autoRotate = true;
    };
    renderer.domElement.addEventListener("dblclick", onDblClick);

    // Resize observer
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
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      controls.dispose();
      // Dispose three resources
      for (const r of Object.values(regionRefs)) {
        r.points.geometry.dispose();
        (r.points.material as THREE.Material).dispose();
        r.glow.geometry.dispose();
        (r.glow.material as THREE.Material).dispose();
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
        "relative w-full aspect-square overflow-hidden rounded-lg",
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
  // 0=jarvis at center; spokes 1..6 + a couple of cross-links
  const edges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
    [4, 1], [3, 2], [1, 5], [2, 6], [5, 6],
  ];
  return (
    <div
      className={cn(
        "relative w-full aspect-square overflow-hidden rounded-lg bg-black/40",
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
                "h-3 w-3 rounded-full transition-all duration-300",
                active
                  ? "scale-150 bg-accent shadow-[0_0_15px_hsl(var(--accent))] animate-pulse"
                  : "bg-primary/50 shadow-[0_0_5px_hsl(var(--primary)/0.5)]",
              )}
            />
            <span
              className={cn(
                "mt-1 font-mono text-[9px] transition-colors",
                active ? "font-bold text-accent" : "text-muted-foreground",
              )}
            >
              {n.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
