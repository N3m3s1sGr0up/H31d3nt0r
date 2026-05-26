import "hono";

declare module "hono" {
  interface ContextVariableMap {
    readonly requestId: string;
  }
}
