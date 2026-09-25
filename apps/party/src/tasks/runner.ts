/**
 * Runs the server work a category module asks for (GameModule.pendingTask),
 * e.g. the AI check of the Bluff-Lexikon definitions, and hands the result
 * back (resolveModuleTask). Generic: the room knows nothing about the
 * category. A failure or timeout resolves with null – the module falls back.
 * Never logs prompts or replies.
 */
import type { ModuleTask } from "@couch-clash/shared";
import type { ModuleRegistry } from "@couch-clash/games";
import { pendingModuleTask, resolveModuleTask, type FlowDeps } from "../game-flow";
import type { JsonModel } from "../generate/model";
import type { RoomRecord } from "../room-logic";

export interface TaskRuntime {
  read(): RoomRecord | null;
  commit(room: RoomRecord): Promise<void>;
  waitUntil(promise: Promise<unknown>): void;
  flowDeps(): FlowDeps;
  /** Null: no API key → every task resolves with null right away. */
  model(quality: "fast" | "strong"): JsonModel | null;
  registry?: ModuleRegistry;
}

class TaskTimeout extends Error {}

async function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TaskTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class ModuleTaskRunner {
  /** Task ids started for the current pending task (cleared when none is pending). */
  private started = new Set<string>();

  constructor(private readonly rt: TaskRuntime) {}

  roomChanged(next: RoomRecord) {
    const task = pendingModuleTask(next, this.rt.registry);
    if (!task) {
      this.started.clear();
      return;
    }
    if (this.started.has(task.id)) return;
    this.started.add(task.id);
    this.rt.waitUntil(this.run(task));
  }

  private async execute(task: ModuleTask): Promise<unknown> {
    const model = this.rt.model(task.model ?? "fast");
    if (!model) return null;
    try {
      return await withTimeout(task.timeoutMs, model(task.input.system, task.input.user));
    } catch (err) {
      console.warn(`task ${task.kind}: ${err instanceof TaskTimeout ? "timeout" : err instanceof Error ? err.message.slice(0, 60) : "error"}`);
      return null;
    }
  }

  private async run(task: ModuleTask) {
    const result = await this.execute(task);
    const room = this.rt.read();
    if (!room) return;
    const next = resolveModuleTask(room, task.id, result, this.rt.flowDeps());
    if (next) await this.rt.commit(next);
  }
}
