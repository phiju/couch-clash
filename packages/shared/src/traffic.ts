/**
 * Führerscheinprüfung: pictures that go with a question – real German
 * traffic signs (files in apps/web/public/signs) or a top-down junction
 * scene we draw ourselves. Client-safe: no answers in here.
 * Format: docs/fuehrerschein/SCHEMA.md.
 */

/** Compass arms of a junction; N is at the top of the screen. Clockwise order. */
export const ARMS = ["N", "E", "S", "W"] as const;
export type Arm = (typeof ARMS)[number];

export const TURNS = ["straight", "left", "right"] as const;
export type Turn = (typeof TURNS)[number];

export const VEHICLE_TYPES = ["car", "truck", "bike", "tram", "bus", "police"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_COLORS = ["rot", "blau", "grün", "gelb"] as const;
export type VehicleColor = (typeof VEHICLE_COLORS)[number];

/** Paint + label chip per colour (the chip helps colour-blind players). */
export const VEHICLE_COLOR_INFO: Record<VehicleColor, { hex: string; label: string }> = {
  rot: { hex: "#CC3E05", label: "Rot" },
  blau: { hex: "#2B6CB0", label: "Blau" },
  grün: { hex: "#3C9A5F", label: "Grün" },
  gelb: { hex: "#FDBC5F", label: "Gelb" },
};

export interface SceneVehicle {
  id: string;
  type: VehicleType;
  color: VehicleColor;
  /** The arm the vehicle comes FROM, driving into the junction. */
  from: Arm;
  turn: Turn;
  /** Police: blue light and siren on. */
  siren?: boolean;
}

export interface ScenePedestrian {
  /** The arm whose crosswalk the pedestrian is on. */
  at: Arm;
  crossing: boolean;
}

export interface SignMedia {
  kind: "sign";
  /** Official StVO numbers (VzKat), main sign first, Zusatzzeichen below. */
  signs: string[];
}

export interface SceneMedia {
  kind: "scene";
  /** 4 = Kreuzung, 3 = Einmündung (T-junction). */
  arms: Arm[];
  /** Signs at each arm, facing the approaching traffic. */
  signs: Partial<Record<Arm, string[]>>;
  /** The two arms connected by the priority road, or null. */
  priorityPath: [Arm, Arm] | null;
  vehicles: SceneVehicle[];
  pedestrians?: ScenePedestrian[];
}

export type QuestionMedia = SignMedia | SceneMedia;

/** Rotation of an arm, clockwise from N, in degrees. */
export const ARM_ANGLE: Record<Arm, number> = { N: 0, E: 90, S: 180, W: 270 };

/** The arm a vehicle leaves through (right-hand traffic, seen from above). */
export function exitArm(from: Arm, turn: Turn): Arm {
  const i = ARMS.indexOf(from);
  const step = turn === "straight" ? 2 : turn === "left" ? 1 : 3;
  return ARMS[(i + step) % 4]!;
}
