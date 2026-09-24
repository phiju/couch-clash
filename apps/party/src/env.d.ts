interface Env {
  Room: DurableObjectNamespace<import("./room").Room>;
}

declare namespace Cloudflare {
  // PartyServer's generics default to Cloudflare.Env.
  interface Env {
    Room: DurableObjectNamespace<import("./room").Room>;
  }
}
