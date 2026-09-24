declare module "sakti:registry" {
  const registry: import("./core/feature.ts").RegistryEntry[];
  export default registry;
}
