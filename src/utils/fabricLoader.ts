import type { fabric as FabricNamespace } from 'fabric';

type Fabric = typeof FabricNamespace;

let cachedFabric: Fabric | null = null;

export async function loadFabric(): Promise<Fabric> {
  if (cachedFabric) {
    return cachedFabric;
  }

  const module = await import('fabric');
  const fabric = ('fabric' in module
    ? (module.fabric as Fabric)
    : (module.default as Fabric))!;
  cachedFabric = fabric;
  return fabric;
}
