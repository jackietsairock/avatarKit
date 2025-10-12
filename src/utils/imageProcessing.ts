type BackgroundRemovalModule = typeof import('@imgly/background-removal');

let backgroundRemovalPromise: Promise<BackgroundRemovalModule> | null = null;

async function loadBackgroundRemoval(): Promise<BackgroundRemovalModule> {
  if (!backgroundRemovalPromise) {
    backgroundRemovalPromise = import('@imgly/background-removal');
  }
  return backgroundRemovalPromise;
}

export async function removeBackground(blob: Blob): Promise<Blob> {
  const module = await loadBackgroundRemoval();
  const result = await module.removeBackground(blob, {
    debug: false
  });

  if (result instanceof Blob) {
    return result;
  }

  const blobCandidate =
    (result && 'blob' in result && result.blob) ||
    ('foreground' in (result as Record<string, unknown>) &&
      (result as { foreground?: Blob }).foreground) ||
    ('image' in (result as Record<string, unknown>) &&
      (result as { image?: Blob }).image);

  if (blobCandidate instanceof Blob) {
    return blobCandidate;
  }

  throw new Error('無法取得去背結果');
}

export async function enhanceIfNeeded(
  dataUrl: string,
  threshold = 700
): Promise<string> {
  const { width, height } = await measureImage(dataUrl);
  if (width >= threshold && height >= threshold) {
    return dataUrl;
  }

  console.warn('影像增強未安裝，改用原圖輸出');
  return dataUrl;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('無法轉成 DataURL'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('讀取失敗'));
    reader.readAsDataURL(blob);
  });
}

export async function measureImage(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('無法取得圖片尺寸'));
    img.src = dataUrl;
  });
}
