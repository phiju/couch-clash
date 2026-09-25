// Minimal Node typings for the test helpers (the worker itself has no Node types).
declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
}

declare module "node:sqlite" {
  interface StatementSync {
    run(...params: unknown[]): { changes: number | bigint };
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}

interface ImportMeta {
  url: string;
}
