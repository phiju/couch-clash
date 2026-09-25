/**
 * Geometry of a junction scene (pure, unit-tested): where roads, signs,
 * vehicles, pedestrians and paths go. The SVG component only draws it.
 *
 * Top-down, N at the top, right-hand traffic, viewBox 0…SIZE. Every arm
 * has an outward unit vector `u` and `v` = the right-hand side of a driver
 * coming IN on that arm (so the incoming lane is on the +v half).
 */
import { ARMS, ARM_ANGLE, exitArm, type Arm, type SceneMedia, type SceneVehicle, type VehicleType } from "@couch-clash/shared";

export const SIZE = 1000;
export const C = SIZE / 2;
/** Half road width (one lane = R). */
export const R = 132;
/** Curb radius at the corners. */
const CURB = 36;
/** Off-screen distance for paths. */
const FAR = C + 320;

export interface Vec {
  x: number;
  y: number;
}

// `+ 0` turns -0 into 0 (cleaner output and comparisons).
const vec = (x: number, y: number): Vec => ({ x: x + 0, y: y + 0 });
const add = (...vs: Vec[]): Vec => vs.reduce((a, b) => vec(a.x + b.x, a.y + b.y), vec(0, 0));
const mul = (a: Vec, k: number): Vec => vec(a.x * k, a.y * k);
const CENTER = vec(C, C);
const round = (n: number) => Math.round(n * 10) / 10;
const pt = (p: Vec) => `${round(p.x)} ${round(p.y)}`;

export function armU(arm: Arm): Vec {
  const r = (ARM_ANGLE[arm] * Math.PI) / 180;
  return vec(Math.round(Math.sin(r)), Math.round(-Math.cos(r)));
}

/** Right-hand side of a driver coming in on `arm`. */
export function armV(arm: Arm): Vec {
  const u = armU(arm);
  return vec(u.y, -u.x);
}

/** Point on arm `arm`: `along` from the centre outward, `side` towards +v. */
export function onArm(arm: Arm, along: number, side: number): Vec {
  return add(CENTER, mul(armU(arm), along), mul(armV(arm), side));
}

// ── Vehicles ─────────────────────────────────────────────────────────────
export const VEHICLE_SIZE: Record<VehicleType, { length: number; width: number }> = {
  car: { length: 112, width: 66 },
  police: { length: 112, width: 66 },
  truck: { length: 160, width: 72 },
  bus: { length: 180, width: 72 },
  tram: { length: 200, width: 64 },
  bike: { length: 86, width: 36 },
};

/** Lateral position in the lane: trams on the rails in the middle, bikes at the right edge. */
function laneOffset(type: VehicleType): number {
  if (type === "tram") return 0;
  if (type === "bike") return R - 24;
  // A little left of the lane centre: room for a bike on the right.
  return R / 2 - 8;
}

/** Gap between the junction edge and the vehicle's front. */
const STOP_GAP = 40;
/** Extra gap when pedestrians cross this arm. */
const PED_GAP = 70;

export interface PathSegment {
  kind: "line" | "quad";
  from: Vec;
  to: Vec;
  ctrl?: Vec;
}

export interface VehicleLayout {
  vehicle: SceneVehicle;
  /** Centre of the vehicle. */
  pos: Vec;
  /** Rotation of the vehicle drawing (drawn nose-up), degrees clockwise. */
  angle: number;
  length: number;
  width: number;
  /** Colour label chip (upright, behind the vehicle). */
  label: Vec;
  /** Dotted arrow: the path through the junction (SVG path data). */
  arrow: string;
  /** Full drive-through path, from the current position to off-screen. */
  path: PathSegment[];
}

function turnPath(v: SceneVehicle, start: Vec, lateral: number): { segments: PathSegment[]; arrowEnd: Vec } {
  const side = armV(v.from);
  const entry = onArm(v.from, R, lateral);
  const out = exitArm(v.from, v.turn);
  const uo = armU(out);
  const vo = armV(out);
  // Outgoing traffic uses the -v half of the exit arm.
  const exitEdge = add(CENTER, mul(uo, R), mul(vo, -lateral));
  const exitFar = add(CENTER, mul(uo, FAR), mul(vo, -lateral));
  const segments: PathSegment[] = [{ kind: "line", from: start, to: entry }];
  if (v.turn === "straight") {
    segments.push({ kind: "line", from: entry, to: exitEdge });
  } else {
    segments.push({ kind: "quad", from: entry, ctrl: add(CENTER, mul(side, lateral), mul(vo, -lateral)), to: exitEdge });
  }
  segments.push({ kind: "line", from: exitEdge, to: exitFar });
  return { segments, arrowEnd: add(exitEdge, mul(uo, 70)) };
}

function pathData(segments: readonly PathSegment[]): string {
  const [first] = segments;
  if (!first) return "";
  return [
    `M ${pt(first.from)}`,
    ...segments.map((s) => (s.kind === "quad" ? `Q ${pt(s.ctrl!)} ${pt(s.to)}` : `L ${pt(s.to)}`)),
  ].join(" ");
}

export function layoutVehicles(scene: SceneMedia): VehicleLayout[] {
  const pedArms = new Set((scene.pedestrians ?? []).map((p) => p.at));
  // Per arm and lane position: queue behind each other.
  const queued = new Map<string, number>();
  const placed = scene.vehicles.map((vehicle) => {
    const { length, width } = VEHICLE_SIZE[vehicle.type];
    const lateral = laneOffset(vehicle.type);
    const queueKey = `${vehicle.from}:${lateral}`;
    const behind = queued.get(queueKey) ?? 0;
    queued.set(queueKey, behind + length + 70);
    const front = R + STOP_GAP + (pedArms.has(vehicle.from) ? PED_GAP : 0) + behind;
    return { vehicle, length, width, lateral, front };
  });
  // Colour chips: one column per arm, behind the last vehicle of that arm.
  const armEnd = new Map<Arm, number>();
  for (const p of placed) armEnd.set(p.vehicle.from, Math.max(armEnd.get(p.vehicle.from) ?? 0, p.front + p.length));
  const labelsPerArm = new Map<Arm, number>();
  return placed.map(({ vehicle, length, width, lateral, front }) => {
    const pos = onArm(vehicle.from, front + length / 2, lateral);
    const nLabel = labelsPerArm.get(vehicle.from) ?? 0;
    labelsPerArm.set(vehicle.from, nLabel + 1);
    const label = onArm(vehicle.from, armEnd.get(vehicle.from)! + 34 + nLabel * 60, lateral);
    const frontPoint = onArm(vehicle.from, front, lateral);
    const { segments, arrowEnd } = turnPath(vehicle, pos, lateral);
    const arrowSegments: PathSegment[] = [
      { kind: "line", from: add(frontPoint, mul(armU(vehicle.from), -8)), to: segments[0]!.to },
      segments[1]!,
      { kind: "line", from: segments[1]!.to, to: arrowEnd },
    ];
    return {
      vehicle,
      pos,
      angle: (ARM_ANGLE[vehicle.from] + 180) % 360,
      length,
      width,
      label,
      arrow: pathData(arrowSegments),
      path: segments,
    };
  });
}

// ── Sampling a path (for the drive-through animation) ────────────────────
function quadAt(s: PathSegment, t: number): Vec {
  const a = s.from;
  const b = s.ctrl!;
  const c = s.to;
  const k = 1 - t;
  return vec(k * k * a.x + 2 * k * t * b.x + t * t * c.x, k * k * a.y + 2 * k * t * b.y + t * t * c.y);
}

/** The path as a polyline (quads sampled). */
export function polyline(segments: readonly PathSegment[]): Vec[] {
  const points: Vec[] = [segments[0]!.from];
  for (const s of segments) {
    if (s.kind === "line") points.push(s.to);
    else for (let i = 1; i <= 16; i++) points.push(quadAt(s, i / 16));
  }
  return points;
}

/** Position and heading (degrees, 0 = up/north, clockwise) at `share` (0…1) of the way. */
export function pointAlong(points: readonly Vec[], share: number): { pos: Vec; angle: number } {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let left = Math.min(1, Math.max(0, share)) * total;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!;
    const a = points[i]!;
    const b = points[i + 1]!;
    if (left <= len || i === lengths.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, left / len);
      const angle = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
      return { pos: vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), angle: (angle + 360) % 360 };
    }
    left -= len;
  }
  return { pos: points[0]!, angle: 0 };
}

// ── Roads ────────────────────────────────────────────────────────────────
/** Outline of all roads as one closed path, rounded curbs between neighbouring arms. */
export function roadOutline(arms: readonly Arm[]): string {
  const present = ARMS.filter((a) => arms.includes(a));
  const isNext = (a: Arm, b: Arm) => (ARMS.indexOf(b) - ARMS.indexOf(a) + 4) % 4 === 1;
  const parts = present.map((arm, i) => {
    const prev = present[(i + present.length - 1) % present.length]!;
    const next = present[(i + 1) % present.length]!;
    const u = armU(arm);
    const v = armV(arm);
    const p1 = add(CENTER, mul(v, R), mul(u, isNext(prev, arm) ? R + CURB : R));
    const p2 = add(CENTER, mul(v, R), mul(u, FAR));
    const p3 = add(CENTER, mul(v, -R), mul(u, FAR));
    const p4 = add(CENTER, mul(v, -R), mul(u, isNext(arm, next) ? R + CURB : R));
    let d = `${i === 0 ? "M" : "L"} ${pt(p1)} L ${pt(p2)} L ${pt(p3)} L ${pt(p4)}`;
    if (isNext(arm, next)) {
      const corner = add(CENTER, mul(v, -R), mul(u, R));
      d += ` Q ${pt(corner)} ${pt(add(CENTER, mul(armV(next), R), mul(armU(next), R + CURB)))}`;
    }
    return d;
  });
  return `${parts.join(" ")} Z`;
}

/** Road edge segments of an arm (for the priority road's yellow edge lines). */
export function armEdges(arm: Arm): [Vec, Vec][] {
  return [R, -R].map((side) => [onArm(arm, R + CURB, side * 0.94), onArm(arm, FAR, side * 0.94)]);
}

/** Priority road through the junction: band from one arm to the other. */
export function priorityBand(path: readonly [Arm, Arm]): string {
  const [a, b] = path;
  const ua = armU(a);
  const ub = armU(b);
  if (ua.x + ub.x === 0 && ua.y + ub.y === 0) {
    return `M ${pt(onArm(a, R, R))} L ${pt(onArm(b, R, -R))} L ${pt(onArm(b, R, R))} L ${pt(onArm(a, R, -R))} Z`;
  }
  // Bent priority road ("abknickende Vorfahrt"): a quarter ring around the inner curb.
  const inner = add(CENTER, mul(ua, R), mul(ub, R));
  const outer = add(CENTER, mul(ua, -R), mul(ub, -R));
  const outerA = add(CENTER, mul(ua, R), mul(ub, -R));
  const outerB = add(CENTER, mul(ub, R), mul(ua, -R));
  return `M ${pt(inner)} L ${pt(outerA)} Q ${pt(outer)} ${pt(outerB)} Z`;
}

// ── Signs ────────────────────────────────────────────────────────────────
export const SIGN_W = 96;
const MAIN_H = 96;
const EXTRA_H = 64;

/** Zusatzzeichen (1000-series) are smaller boards under the main sign. */
export const isExtraSign = (sign: string) => /^10\d\d/.test(sign);

export interface SignLayout {
  arm: Arm;
  /** Top-left of the stack (upright, never rotated). */
  x: number;
  y: number;
  boards: { sign: string; y: number; h: number }[];
  /** Post from the bottom of the stack down to the ground point. */
  postTop: number;
  postBottom: number;
}

export function layoutSigns(scene: SceneMedia): SignLayout[] {
  return ARMS.flatMap((arm) => {
    const signs = scene.signs[arm];
    if (!signs?.length) return [];
    let y = 0;
    const boards = signs.map((sign) => {
      const h = isExtraSign(sign) ? EXTRA_H : MAIN_H;
      const board = { sign, y, h };
      y += h + 6;
      return board;
    });
    const stackH = y - 6;
    const post = 34;
    const w = SIGN_W;
    const h = stackH + post;
    const u = armU(arm);
    // Extent of the stack along the arm and across it (the stack is upright).
    const alongExtent = u.x !== 0 ? w : h;
    const acrossExtent = u.x !== 0 ? h : w;
    const center = onArm(arm, R + CURB + alongExtent / 2 + 40, R + acrossExtent / 2 + 22);
    const top = center.y - h / 2;
    return [
      {
        arm,
        x: center.x - w / 2,
        y: top,
        boards: boards.map((b) => ({ ...b, y: top + b.y })),
        postTop: top + stackH,
        postBottom: top + h,
      },
    ];
  });
}

/** Stop / give-way line across the incoming lane, only at arms with a 205 or 206 sign. */
export function waitLine(scene: SceneMedia, arm: Arm): { kind: "stop" | "yield"; from: Vec; to: Vec } | null {
  const signs = scene.signs[arm] ?? [];
  const kind = signs.includes("206") ? "stop" : signs.includes("205") ? "yield" : null;
  if (!kind) return null;
  return { kind, from: onArm(arm, R + 16, 6), to: onArm(arm, R + 16, R - 6) };
}

// ── Pedestrians ──────────────────────────────────────────────────────────
export interface PedestrianLayout {
  id: string;
  arm: Arm;
  /** Standing at the curb, ready to cross. */
  start: Vec;
  /** The other side. */
  end: Vec;
  /** Where the "Fußgänger" chip goes (further out on the arm). */
  label: Vec;
  /** Crossing markings (two dashed lines). */
  crossing: [Vec, Vec][];
  angle: number;
}

export function layoutPedestrians(scene: SceneMedia): PedestrianLayout[] {
  return (scene.pedestrians ?? []).map((p) => {
    const along = R + 58;
    const start = onArm(p.at, along, -R + 26);
    const end = onArm(p.at, along, R + 60);
    const v = armV(p.at);
    return {
      id: `ped:${p.at}`,
      arm: p.at,
      start,
      end,
      label: onArm(p.at, along + 120, -R + 26),
      crossing: [
        [onArm(p.at, along - 34, -R), onArm(p.at, along - 34, R)],
        [onArm(p.at, along + 34, -R), onArm(p.at, along + 34, R)],
      ],
      angle: (Math.atan2(v.x, -v.y) * 180) / Math.PI,
    };
  });
}

/** Dashed centre line of an arm (from the junction outward). */
export function centreLine(arm: Arm): [Vec, Vec] {
  return [onArm(arm, R + CURB + 10, 0), onArm(arm, FAR, 0)];
}

/** Tram rails: along the tram's path, through the junction. */
export function railPath(vehicle: SceneVehicle, offset: number): string {
  const lateral = offset;
  const start = onArm(vehicle.from, FAR, lateral);
  return pathData(turnPath(vehicle, start, lateral).segments);
}
