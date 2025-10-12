type BackgroundRemovalModule = typeof import('@imgly/background-removal');

let modulePromise: Promise<BackgroundRemovalModule> | null = null;

async function loadModule(): Promise<BackgroundRemovalModule> {
  if (!modulePromise) {
    modulePromise = import('@imgly/background-removal');
  }
  return modulePromise;
}

export type BackgroundRemovalOptions = Record<string, unknown>;

export async function removeBackgroundFromFile(
  file: Blob,
  options?: BackgroundRemovalOptions
): Promise<Blob> {
  const module = await loadModule();
  const result = await module.removeBackground(file, options);

  if (result instanceof Blob) {
    return result;
  }

  if (result && typeof result === 'object') {
    if ('blob' in result && result.blob instanceof Blob) {
      return result.blob;
    }
    if ('foreground' in result && result.foreground instanceof Blob) {
      return result.foreground;
    }
    if ('image' in result && result.image instanceof Blob) {
      return result.image;
    }
  }

  throw new Error('無法取得去背結果');
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('無法轉換為 DataURL'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('讀取 Blob 失敗'));
    reader.readAsDataURL(blob);
  });
}
