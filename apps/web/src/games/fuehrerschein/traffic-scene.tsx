"use client";

/**
 * <TrafficScene>: a junction from above, drawn from the question's data
 * (docs/fuehrerschein/SCHEMA.md). 70s game-show look: rounded shapes,
 * thick brown outlines, bulb-yellow accents. Signs are the real SVGs and
 * always stand upright; vehicles carry a colour chip (never A/B/C/D – those
 * are the answer buttons). At the reveal the vehicles drive through in the
 * answer's order (skippable by a click; reduced motion: numbers instead).
 */
import { ARMS, VEHICLE_COLOR_INFO, type SceneMedia, type VehicleType } from "@couch-clash/shared";
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { driveProgress, driveSchedule, driveTotalMs } from "./logic";
import {
  C,
  R,
  SIGN_W,
  SIZE,
  armEdges,
  centreLine,
  layoutPedestrians,
  layoutSigns,
  layoutVehicles,
  pointAlong,
  polyline,
  priorityBand,
  railPath,
  roadOutline,
  waitLine,
  type PedestrianLayout,
  type VehicleLayout,
} from "./scene-layout";

const BROWN = "#562512";
const ASPHALT = "#4b4d52";
const GRASS = "#5e9e7c";
const BULB = "#FDBC5F";
const CREAM = "#FFF3D6";

export interface TrafficSceneProps {
  scene: SceneMedia;
  /** "phone": small and still (no animation). */
  variant?: "tv" | "phone";
  /** Reveal: drive through in this order (vehicle ids, "ped:<arm>"). */
  driveOrder?: readonly string[] | null;
  className?: string;
  /** Tests / screenshots: freeze the drive-through at this time (ms). */
  frozenAtMs?: number;
}

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Milliseconds since the drive-through started; jumps to the end when skipped. */
function useDriveClock(active: boolean, totalMs: number, frozenAtMs?: number): [number, () => void] {
  const [elapsed, setElapsed] = useState(0);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!active || skipped || frozenAtMs !== undefined) return;
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const t = performance.now() - start;
      setElapsed(t);
      if (t < totalMs) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, skipped, totalMs, frozenAtMs]);
  if (frozenAtMs !== undefined) return [frozenAtMs, () => {}];
  return [skipped ? totalMs : active ? elapsed : 0, () => setSkipped(true)];
}

export function TrafficScene({ scene, variant = "tv", driveOrder = null, className = "", frozenAtMs }: TrafficSceneProps) {
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const vehicles = useMemo(() => layoutVehicles(scene), [scene]);
  const signs = useMemo(() => layoutSigns(scene), [scene]);
  const pedestrians = useMemo(() => layoutPedestrians(scene), [scene]);
  const still = variant === "phone";
  const drive = !!driveOrder && !still && !reduced;
  const schedule = useMemo(() => driveSchedule(driveOrder ?? []), [driveOrder]);
  const [elapsed, skip] = useDriveClock(drive, driveTotalMs(driveOrder ?? []), frozenAtMs);
  const slot = (id: string) => schedule.find((s) => s.id === id);
  const orderNumber = (id: string) => (driveOrder ? driveOrder.indexOf(id) + 1 : 0);
  const trams = scene.vehicles.filter((v) => v.type === "tram");

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={`traffic-scene select-none ${className}`}
      data-still={still || undefined}
      role="img"
      aria-label={describeScene(scene)}
      onClick={drive ? skip : undefined}
    >
      <defs>
        <clipPath id={`${uid}-frame`}>
          <rect width={SIZE} height={SIZE} rx={46} />
        </clipPath>
        <pattern id={`${uid}-grass`} width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="80" height="80" fill={GRASS} />
          <rect width="40" height="80" fill="#66a684" />
        </pattern>
        <marker id={`${uid}-head`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={BULB} stroke={BROWN} strokeWidth="1.2" />
        </marker>
        <filter id={`${uid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#000" floodOpacity="0.35" />
        </filter>
      </defs>

      <g clipPath={`url(#${uid}-frame)`}>
        <rect width={SIZE} height={SIZE} fill={`url(#${uid}-grass)`} />
        <Decor arms={scene.arms} />

        {/* Roads: a thick brown curb under the asphalt gives one outline for the whole junction. */}
        <path d={roadOutline(scene.arms)} fill={ASPHALT} stroke={BROWN} strokeWidth={16} strokeLinejoin="round" />
        <path d={roadOutline(scene.arms)} fill={ASPHALT} />
        {scene.priorityPath && (
          <g>
            <path d={priorityBand(scene.priorityPath)} fill={BULB} opacity={0.16} />
            {scene.priorityPath.flatMap((arm) =>
              armEdges(arm).map(([a, b], i) => (
                <line key={`${arm}${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={BULB} strokeWidth={9} strokeLinecap="round" opacity={0.9} />
              )),
            )}
          </g>
        )}
        {scene.arms.map((arm) => {
          const [a, b] = centreLine(arm);
          return <line key={arm} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={CREAM} strokeWidth={7} strokeDasharray="34 26" opacity={0.9} />;
        })}
        {ARMS.map((arm) => {
          const line = waitLine(scene, arm);
          if (!line) return null;
          return line.kind === "stop" ? (
            <line key={arm} x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} stroke={CREAM} strokeWidth={14} />
          ) : (
            <line key={arm} x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} stroke={CREAM} strokeWidth={10} strokeDasharray="16 12" />
          );
        })}
        {trams.flatMap((t) =>
          [-13, 13].map((offset) => (
            <path key={`${t.id}${offset}`} d={railPath(t, offset)} fill="none" stroke="#9aa0a6" strokeWidth={5} strokeLinecap="round" />
          )),
        )}
        {pedestrians.map((p) =>
          p.crossing.map(([a, b], i) => (
            <line key={`${p.id}${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={CREAM} strokeWidth={6} strokeDasharray="14 12" opacity={0.75} />
          )),
        )}

        {/* Turn intentions: dotted arrows (hidden while driving). */}
        {vehicles.map((v) => (
          <path
            key={v.vehicle.id}
            d={v.arrow}
            fill="none"
            stroke={BULB}
            strokeWidth={10}
            strokeDasharray="0.1 19"
            strokeLinecap="round"
            markerEnd={`url(#${uid}-head)`}
            opacity={drive && elapsed > (slot(v.vehicle.id)?.startMs ?? Infinity) ? 0 : 0.95}
            className="transition-opacity duration-300"
          />
        ))}

        {pedestrians.map((p) => (
          <Pedestrian key={p.id} layout={p} progress={drive ? driveProgress(slot(p.id), elapsed) : 0} />
        ))}
        {vehicles.map((v) => (
          <Vehicle key={v.vehicle.id} layout={v} progress={drive ? driveProgress(slot(v.vehicle.id), elapsed) : 0} shadow={`url(#${uid}-shadow)`} />
        ))}

        {/* Signs: upright, on a post at the right-hand side before the junction. */}
        {signs.map((s) => (
          <g key={s.arm} filter={still ? undefined : `url(#${uid}-shadow)`}>
            <rect x={s.x + SIGN_W / 2 - 5} y={s.postTop - 4} width={10} height={s.postBottom - s.postTop + 4} rx={4} fill="#8d8f93" stroke={BROWN} strokeWidth={3} />
            {s.boards.map((b) => (
              <image key={`${b.sign}${b.y}`} href={`/signs/${b.sign}.svg`} x={s.x} y={b.y} width={SIGN_W} height={b.h} preserveAspectRatio="xMidYMid meet" />
            ))}
          </g>
        ))}

        {/* Colour chips (upright) – and the order at the reveal. */}
        {vehicles.map((v) => {
          const gone = drive && driveProgress(slot(v.vehicle.id), elapsed) > 0.15;
          return (
            <ColorChip
              key={v.vehicle.id}
              x={v.label.x}
              y={v.label.y}
              color={VEHICLE_COLOR_INFO[v.vehicle.color].hex}
              text={VEHICLE_COLOR_INFO[v.vehicle.color].label}
              order={driveOrder ? orderNumber(v.vehicle.id) : 0}
              hidden={gone}
            />
          );
        })}
        {pedestrians.map((p) => (
          <ColorChip
            key={p.id}
            x={p.label.x}
            y={p.label.y}
            color={CREAM}
            text="Fußgänger"
            order={driveOrder ? orderNumber(p.id) : 0}
            hidden={drive && driveProgress(slot(p.id), elapsed) > 0.15}
          />
        ))}
      </g>
      <rect x={4} y={4} width={SIZE - 8} height={SIZE - 8} rx={44} fill="none" stroke={BROWN} strokeWidth={8} />
    </svg>
  );
}

/** Screen-reader text: "Kreuzung. Rot von unten, biegt links ab. …" */
export function describeScene(scene: SceneMedia): string {
  const where = { N: "oben", E: "rechts", S: "unten", W: "links" } as const;
  const turn = { straight: "fährt geradeaus", left: "biegt links ab", right: "biegt rechts ab" } as const;
  const kind = scene.arms.length === 4 ? "Kreuzung" : "Einmündung";
  const parts = scene.vehicles.map((v) => `${VEHICLE_COLOR_INFO[v.color].label} (${TYPE_NAMES[v.type]}) von ${where[v.from]}, ${turn[v.turn]}`);
  const peds = (scene.pedestrians ?? []).map((p) => `Fußgänger ${where[p.at]}`);
  return [kind, ...parts, ...peds].join(". ");
}

const TYPE_NAMES: Record<VehicleType, string> = {
  car: "Auto",
  truck: "Lkw",
  bike: "Fahrrad",
  tram: "Straßenbahn",
  bus: "Bus",
  police: "Polizeiauto",
};

function ColorChip({ x, y, color, text, order, hidden }: { x: number; y: number; color: string; text: string; order: number; hidden: boolean }) {
  const w = 52 + text.length * 22 + (order ? 50 : 0);
  return (
    <g transform={`translate(${x} ${y})`} opacity={hidden ? 0 : 1} className="transition-opacity duration-300">
      <rect x={-w / 2} y={-28} width={w} height={56} rx={28} fill={CREAM} stroke={BROWN} strokeWidth={5} />
      {order > 0 && (
        <>
          <circle cx={-w / 2 + 28} cy={0} r={22} fill={BROWN} />
          <text x={-w / 2 + 28} y={12} textAnchor="middle" fontSize={32} fontWeight={700} fill={BULB} className="font-display">
            {order}
          </text>
        </>
      )}
      <circle cx={-w / 2 + (order ? 74 : 28)} cy={0} r={13} fill={color} stroke={BROWN} strokeWidth={3} />
      <text x={-w / 2 + (order ? 94 : 48)} y={12} fontSize={35} fontWeight={700} fill={BROWN} className="font-display">
        {text}
      </text>
    </g>
  );
}

function Vehicle({ layout, progress, shadow }: { layout: VehicleLayout; progress: number; shadow: string }) {
  const points = useMemo(() => polyline(layout.path), [layout.path]);
  const { pos, angle } = progress > 0 ? pointAlong(points, progress) : { pos: layout.pos, angle: layout.angle };
  const v = layout.vehicle;
  const paint = VEHICLE_COLOR_INFO[v.color].hex;
  return (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${angle})`} filter={shadow}>
      <VehicleBody type={v.type} paint={paint} length={layout.length} width={layout.width} siren={!!v.siren} />
      {v.turn !== "straight" && <Blinkers side={v.turn} length={layout.length} width={layout.width} />}
    </g>
  );
}

/** Indicator lights on the turn side, front and back (blinking; steady with reduced motion / on phones). */
function Blinkers({ side, length, width }: { side: "left" | "right"; length: number; width: number }) {
  const x = (side === "left" ? -1 : 1) * (width / 2 - 1);
  return (
    <g className="ts-blink">
      {[-1, 1].map((end) => (
        <g key={end}>
          <circle cx={x} cy={end * (length / 2 - 9)} r={15} fill={BULB} opacity={0.45} />
          <circle cx={x} cy={end * (length / 2 - 9)} r={8} fill="#ff9d1c" stroke={BROWN} strokeWidth={2.5} />
        </g>
      ))}
    </g>
  );
}

/** Vehicles are drawn nose-up, centred on 0/0. */
function VehicleBody({ type, paint, length: L, width: W, siren }: { type: VehicleType; paint: string; length: number; width: number; siren: boolean }) {
  const glass = "#cfe6ea";
  const stroke = { stroke: BROWN, strokeWidth: 5, strokeLinejoin: "round" as const };
  switch (type) {
    case "bike":
      return (
        <g>
          <rect x={-4} y={-L / 2} width={8} height={24} rx={4} fill="#26211f" stroke={CREAM} strokeWidth={2} />
          <rect x={-4} y={L / 2 - 24} width={8} height={24} rx={4} fill="#26211f" stroke={CREAM} strokeWidth={2} />
          <line x1={0} y1={-L / 2 + 20} x2={0} y2={L / 2 - 20} stroke={paint} strokeWidth={7} strokeLinecap="round" />
          <line x1={-16} y1={-L / 2 + 17} x2={16} y2={-L / 2 + 17} stroke={BROWN} strokeWidth={5} strokeLinecap="round" />
          <ellipse cx={0} cy={4} rx={W / 2 + 2} ry={14} fill={paint} {...stroke} strokeWidth={4} />
          <circle cx={0} cy={0} r={11} fill="#7a4a2a" stroke={BROWN} strokeWidth={3} />
        </g>
      );
    case "tram":
      return (
        <g>
          <rect x={-W / 2} y={-L / 2} width={W} height={L} rx={24} fill={paint} {...stroke} />
          {[-L / 6, L / 6].map((y) => (
            <line key={y} x1={-W / 2} y1={y} x2={W / 2} y2={y} stroke={BROWN} strokeWidth={4} />
          ))}
          <rect x={-W / 2 + 8} y={-L / 2 + 10} width={W - 16} height={14} rx={6} fill={glass} stroke={BROWN} strokeWidth={3} />
          <rect x={-W / 2 + 8} y={L / 2 - 24} width={W - 16} height={14} rx={6} fill={glass} stroke={BROWN} strokeWidth={3} />
          <path d={`M -12 -20 L 12 -8 L -12 4 L 12 16`} fill="none" stroke={BROWN} strokeWidth={4} strokeLinecap="round" />
          <rect x={-W / 2 + 4} y={-L / 2 + 34} width={6} height={L - 68} rx={3} fill={CREAM} opacity={0.6} />
          <rect x={W / 2 - 10} y={-L / 2 + 34} width={6} height={L - 68} rx={3} fill={CREAM} opacity={0.6} />
        </g>
      );
    case "bus":
      return (
        <g>
          <rect x={-W / 2} y={-L / 2} width={W} height={L} rx={18} fill={paint} {...stroke} />
          <rect x={-W / 2 + 7} y={-L / 2 + 9} width={W - 14} height={16} rx={6} fill={glass} stroke={BROWN} strokeWidth={3} />
          <rect x={-W / 2 + 10} y={-L / 2 + 36} width={W - 20} height={L - 56} rx={8} fill={CREAM} opacity={0.5} />
        </g>
      );
    case "truck":
      return (
        <g>
          <rect x={-W / 2} y={-L / 2 + 44} width={W} height={L - 44} rx={10} fill={CREAM} {...stroke} />
          <rect x={-W / 2 + 6} y={-L / 2 + 52} width={W - 12} height={L - 60} rx={6} fill={paint} opacity={0.35} />
          <rect x={-W / 2 + 3} y={-L / 2} width={W - 6} height={40} rx={12} fill={paint} {...stroke} />
          <rect x={-W / 2 + 10} y={-L / 2 + 7} width={W - 20} height={12} rx={5} fill={glass} stroke={BROWN} strokeWidth={3} />
        </g>
      );
    case "car":
    case "police":
      return (
        <g>
          <rect x={-W / 2} y={-L / 2} width={W} height={L} rx={18} fill={paint} {...stroke} />
          <rect x={-W / 2 + 7} y={-L / 2 + 20} width={W - 14} height={17} rx={6} fill={glass} stroke={BROWN} strokeWidth={3} />
          <rect x={-W / 2 + 8} y={-L / 2 + 41} width={W - 16} height={24} rx={7} fill="#fff" opacity={type === "police" ? 0.95 : 0.2} />
          <rect x={-W / 2 + 8} y={L / 2 - 22} width={W - 16} height={11} rx={5} fill={glass} stroke={BROWN} strokeWidth={3} />
          <circle cx={-W / 2 + 10} cy={-L / 2 + 7} r={5} fill={CREAM} />
          <circle cx={W / 2 - 10} cy={-L / 2 + 7} r={5} fill={CREAM} />
          {type === "police" && (
            <g className={siren ? "ts-siren" : undefined}>
              <rect x={-W / 2 + 10} y={-L / 2 + 45} width={W - 20} height={14} rx={6} fill="#1f3a8a" stroke={BROWN} strokeWidth={2.5} />
              <circle className="ts-siren-a" cx={-9} cy={-L / 2 + 52} r={siren ? 9 : 5} fill="#4aa3ff" />
              <circle className="ts-siren-b" cx={9} cy={-L / 2 + 52} r={siren ? 9 : 5} fill="#4aa3ff" />
              {siren && <circle className="ts-siren-glow" cx={0} cy={-L / 2 + 52} r={40} fill="#4aa3ff" opacity={0.3} />}
            </g>
          )}
        </g>
      );
  }
}

function Pedestrian({ layout, progress }: { layout: PedestrianLayout; progress: number }) {
  const x = layout.start.x + (layout.end.x - layout.start.x) * progress;
  const y = layout.start.y + (layout.end.y - layout.start.y) * progress;
  return (
    <g>
      {progress === 0 && (
        <line
          x1={layout.start.x}
          y1={layout.start.y}
          x2={layout.end.x}
          y2={layout.end.y}
          stroke={BULB}
          strokeWidth={9}
          strokeDasharray="0.1 18"
          strokeLinecap="round"
        />
      )}
      <g transform={`translate(${x} ${y}) rotate(${layout.angle})`} className="ts-walk">
        <ellipse cx={0} cy={0} rx={30} ry={17} fill="#e15a14" stroke={BROWN} strokeWidth={4} />
        <circle cx={0} cy={-1} r={13} fill="#6b3b1f" stroke={BROWN} strokeWidth={3} />
      </g>
    </g>
  );
}

/** Bushes in the corners; a hedge where a T-junction has no arm. */
function Decor({ arms }: { arms: readonly string[] }) {
  const bush = (x: number, y: number, r: number) => (
    <g key={`${x}-${y}`}>
      <circle cx={x} cy={y} r={r} fill="#3d7d5a" stroke={BROWN} strokeWidth={5} />
      <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.35} fill="#5aa079" />
    </g>
  );
  const far = 80;
  const items = [bush(far, far, 48), bush(SIZE - far, far, 42), bush(far, SIZE - far, 44), bush(SIZE - far, SIZE - far, 50)];
  const missing = ARMS.find((a) => !arms.includes(a));
  if (missing) {
    const hedge = [-2, -1, 0, 1, 2].map((i) => {
      const along = C - R - 70;
      const pos = { N: [C + i * 70, C - along], S: [C + i * 70, C + along], E: [C + along, C + i * 70], W: [C - along, C + i * 70] }[missing]!;
      return bush(pos[0]!, pos[1]!, 34);
    });
    items.push(...hedge);
  }
  return <g>{items}</g>;
}
