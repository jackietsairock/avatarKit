import type { fabric as FabricNamespace } from 'fabric';

type Fabric = typeof FabricNamespace;

let cachedFabric: Fabric | null = null;

export async function loadFabric(): Promise<Fabric> {
  if (cachedFabric) {
    return cachedFabric;
  }

  const module = await import('fabric');

  const namespace =
    (module as { fabric?: Fabric }).fabric ??
    (module as { default?: Fabric }).default ??
    (('Canvas' in module ? module : null) as Fabric | null);

  if (!namespace || typeof namespace.Canvas !== 'function') {
    throw new Error('無法載入 fabric.js');
  }

  cachedFabric = namespace;
  return cachedFabric;
}
