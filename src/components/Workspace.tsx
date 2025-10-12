import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { twMerge } from 'tailwind-merge';
import { loadFabric } from '../utils/fabricLoader.js';
import {
  blobToDataUrl,
  removeBackgroundFromFile
} from '../utils/backgroundRemoval.js';

declare const __AVATAR_MAX_FILES__: number;

type FabricType = Awaited<ReturnType<typeof loadFabric>>;
type FabricCanvasInstance = InstanceType<FabricType['Canvas']>;
type FabricImageInstance = InstanceType<FabricType['Image']>;

type BackgroundSetting =
  | { mode: 'transparent' }
  | { mode: 'color'; color: string }
  | { mode: 'gradient'; from: string; to: string; angle: number }
  | {
      mode: 'pattern';
      preset: 'dots' | 'grid';
      colorA: string;
      colorB: string;
    };

type BatchControls = {
  scale: number;
  rotate: number;
  offsetX: number;
  offsetY: number;
};

type ItemOverrides = {
  scale: number;
  rotate: number;
  offsetX: number;
  offsetY: number;
};

type AvatarStatus = 'queued' | 'processing' | 'ready' | 'error' | 'skipped';

type AvatarItem = {
  id: string;
  originalName: string;
  file: File;
  status: AvatarStatus;
  retries: number;
  previewUrl: string;
  processedDataUrl?: string;
  width?: number | null;
  height?: number | null;
  errorMessage?: string;
  overrides: ItemOverrides;
};

type EditMode = 'batch' | 'single';

type ExportOptions = {
  format: 'png' | 'webp';
  quality: number;
  scale: 1 | 2;
  namingPattern: '{index}_{origName}';
  transparentBackground: boolean;
};

type CanvasSettings = {
  size: number;
  shape: 'circle' | 'square';
  cornerRadius: number;
  background: BackgroundSetting;
};

type WorkspaceSettings = {
  canvas: CanvasSettings;
  batch: BatchControls;
  export: ExportOptions;
};

type ProgressState = {
  total: number;
  processed: number;
  exporting: boolean;
  stage: 'idle' | 'removal' | 'render' | 'export';
};

const MAX_FILES =
  Number(
    import.meta.env.PUBLIC_MAX_FILES ??
      (typeof __AVATAR_MAX_FILES__ !== 'undefined'
        ? __AVATAR_MAX_FILES__
        : 50)
  ) || 50;

const CANVAS_SIZES = [512, 800, 1080, 2048] as const;
const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp';
const DEFAULT_OVERRIDES: ItemOverrides = {
  scale: 1,
  rotate: 0,
  offsetX: 0,
  offsetY: 0
};

const DEFAULT_SETTINGS: WorkspaceSettings = {
  canvas: {
    size: 800,
    shape: 'circle',
    cornerRadius: 48,
    background: { mode: 'color', color: '#F5F5F5' }
  },
  batch: {
    scale: 0.8,
    rotate: 0,
    offsetX: 0,
    offsetY: 0
  },
  export: {
    format: 'png',
    quality: 0.92,
    scale: 1,
    namingPattern: 'avatar_{index}',
    transparentBackground: true
  }
};

const LS_SETTINGS_KEY = 'avatarkit.settings.v1';

const patternCache = new Map<string, HTMLCanvasElement>();

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('無法讀取檔案'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}

async function getImageDimensions(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => reject(new Error('取得圖片尺寸失敗'));
    image.src = dataUrl;
  });
}

function usePersistentSettings(): [WorkspaceSettings, (s: WorkspaceSettings) => void] {
  const [settings, setSettings] = useState<WorkspaceSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
      const raw = window.localStorage.getItem(LS_SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(raw) as WorkspaceSettings;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        canvas: {
          ...DEFAULT_SETTINGS.canvas,
          ...parsed.canvas
        },
        batch: {
          ...DEFAULT_SETTINGS.batch,
          ...parsed.batch
        },
        export: {
          ...DEFAULT_SETTINGS.export,
          ...parsed.export
        }
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  return [settings, setSettings];
}

function formatProgressLabel(progress: ProgressState) {
  switch (progress.stage) {
    case 'removal':
      return `去背中 ${progress.processed}/${progress.total}`;
    case 'render':
      return '載入畫布';
    case 'export':
      return '導出壓縮中';
    default:
      return '待命';
  }
}

function createPatternCanvas(
  mode: 'dots' | 'grid',
  colorA: string,
  colorB: string
) {
  const key = `${mode}-${colorA}-${colorB}`;
  const cached = patternCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const size = mode === 'dots' ? 64 : 48;
  canvas.width = size;
  canvas.height = size;

  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = colorB;

  if (mode === 'dots') {
    const radius = size * 0.12;
    for (let y = radius * 2; y < size + radius; y += radius * 3) {
      for (let x = radius * 2; x < size + radius; x += radius * 3) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    const lineWidth = 3;
    ctx.lineWidth = lineWidth;
    for (let x = 0; x <= size; x += size / 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y <= size; y += size / 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  }

  patternCache.set(key, canvas);
  return canvas;
}

function applyBackgroundToCanvas(
  fabricInstance: FabricType,
  canvas: FabricCanvasInstance,
  background: BackgroundSetting
) {
  switch (background.mode) {
    case 'transparent':
      canvas.setBackgroundColor(undefined, canvas.renderAll.bind(canvas));
      break;
    case 'color':
      canvas.setBackgroundColor(background.color, canvas.renderAll.bind(canvas));
      break;
    case 'gradient': {
      const angle = background.angle % 360;
      const radians = (angle * Math.PI) / 180;
      const center = { x: 0.5, y: 0.5 };
      const delta = {
        x: Math.cos(radians) * 0.5,
        y: Math.sin(radians) * 0.5
      };
      const gradient = new fabricInstance.Gradient({
        type: 'linear',
        coords: {
          x1: (center.x - delta.x) * 100,
          y1: (center.y - delta.y) * 100,
          x2: (center.x + delta.x) * 100,
          y2: (center.y + delta.y) * 100
        },
        gradientUnits: 'percentage',
        colorStops: [
          { color: background.from, offset: 0 },
          { color: background.to, offset: 1 }
        ]
      });
      canvas.setBackgroundColor(gradient, canvas.renderAll.bind(canvas));
      break;
    }
    case 'pattern': {
      const source = createPatternCanvas(
        background.preset,
        background.colorA,
        background.colorB
      );
      const pattern = new fabricInstance.Pattern({
        source,
        repeat: 'repeat'
      });
      canvas.setBackgroundColor(pattern, canvas.renderAll.bind(canvas));
      break;
    }
  }
}

function computeClipPath(
  fabricInstance: FabricType,
  size: number,
  settings: CanvasSettings
) {
  if (settings.shape === 'circle') {
    return new fabricInstance.Circle({
      radius: size / 2,
      left: size / 2,
      top: size / 2,
      originX: 'center',
      originY: 'center',
      absolutePositioned: true
    });
  }

  return new fabricInstance.Rect({
    width: size,
    height: size,
    rx: settings.cornerRadius,
    ry: settings.cornerRadius,
    left: 0,
    top: 0,
    absolutePositioned: true
  });
}

function generateFileName(
  pattern: string,
  index: number,
  item: AvatarItem,
  format: 'png' | 'webp'
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '');
  return pattern
    .replace('{index}', String(index + 1))
    .replace('{origName}', item.originalName.replace(/\.[^/.]+$/, ''))
    .replace('{timestamp}', timestamp)
    .concat(`.${format}`);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const Workspace: React.FC = () => {
  const [settings, setSettings] = usePersistentSettings();
  const [items, setItems] = useState<AvatarItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('batch');
  const [progress, setProgress] = useState<ProgressState>({
    total: 0,
    processed: 0,
    exporting: false,
    stage: 'idle'
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<FabricCanvasInstance | null>(null);
  const fabricImageRef = useRef<FabricImageInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const processingRef = useRef(false);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0],
    [items, selectedId]
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    let mounted = true;
    let fabricInstance: Awaited<ReturnType<typeof loadFabric>>;

    const setup = async () => {
      fabricInstance = await loadFabric();
      if (!mounted || !canvasRef.current) return;

      const canvasElement = canvasRef.current;
      const canvas = new fabricInstance.Canvas(canvasElement, {
        selection: false,
        preserveObjectStacking: true
      });

      canvas.setDimensions({
        width: settings.canvas.size,
        height: settings.canvas.size
      });

      applyBackgroundToCanvas(fabricInstance, canvas, settings.canvas.background);
      canvas.clipPath = computeClipPath(
        fabricInstance,
        settings.canvas.size,
        settings.canvas
      );

      fabricCanvasRef.current = canvas;
    };

    setup();

    return () => {
      mounted = false;
      fabricCanvasRef.current?.dispose();
      fabricCanvasRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.setDimensions({
      width: settings.canvas.size,
      height: settings.canvas.size
    });

    void loadFabric().then((fabricInstance) => {
      applyBackgroundToCanvas(
        fabricInstance,
        canvas,
        settings.canvas.background
      );
      canvas.clipPath = computeClipPath(
        fabricInstance,
        settings.canvas.size,
        settings.canvas
      );

      canvas.renderAll();
    });
  }, [settings.canvas]);

  const updateFabricImage = useCallback(
    async (targetItem: AvatarItem | undefined, animate = false) => {
      const item = targetItem || selectedItem;
      const canvas = fabricCanvasRef.current;

      if (!canvas) return;

      if (!item || item.status !== 'ready' || !item.processedDataUrl) {
        if (fabricImageRef.current) {
          canvas.remove(fabricImageRef.current);
          fabricImageRef.current = null;
          canvas.renderAll();
        }
        return;
      }

      const fabricInstance = await loadFabric();
      const overrides = item.overrides;
      const batch = settings.batch;

      const existing = fabricImageRef.current;
      const scaleMultiplier = clamp(batch.scale * overrides.scale, 0.1, 3);
      const rotation = batch.rotate + overrides.rotate;
      const translateX = clamp(batch.offsetX + overrides.offsetX, -settings.canvas.size, settings.canvas.size);
      const translateY = clamp(batch.offsetY + overrides.offsetY, -settings.canvas.size, settings.canvas.size);

      const applyToImage = (image: fabric.Image) => {
        const { width = settings.canvas.size, height = settings.canvas.size } =
          item;

        const base = Math.min(
          settings.canvas.size / width,
          settings.canvas.size / height
        );

        image.set({
          originX: 'center',
          originY: 'center',
          left: settings.canvas.size / 2 + translateX,
          top: settings.canvas.size / 2 + translateY,
          angle: rotation,
          selectable: false,
          evented: false
        });

        image.scale(scaleMultiplier * base);

        if (existing) {
          canvas.remove(existing);
        }

        fabricImageRef.current = image;
        canvas.add(image);
        canvas.renderAll();
      };

      if (existing && existing.data?.id === item.id) {
        applyToImage(existing);
        return;
      }

      await new Promise<void>((resolve) => {
        let finished = false;
        const complete = () => {
          if (finished) return;
          finished = true;
          resolve();
        };

        fabricInstance.Image.fromURL(
          item.processedDataUrl,
          (image) => {
            image.data = { id: item.id };
            applyToImage(image);

            if (animate) {
              image.set('opacity', 0);
              canvas.renderAll();
              fabricInstance.util.animate({
                startValue: 0,
                endValue: 1,
                duration: 280,
                onChange: (value) => {
                  image.set('opacity', value);
                  canvas.renderAll();
                },
                onComplete: complete
              });
            } else {
              complete();
            }
          },
          {
            crossOrigin: 'anonymous'
          }
        );
        setTimeout(complete, 500);
      });
    },
    [selectedItem, settings.batch, settings.canvas]
  );

  useEffect(() => {
    void updateFabricImage(selectedItem);
  }, [selectedItem, updateFabricImage, settings.batch]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.defaultPrevented
      ) {
        return;
      }

      const key = event.key;
      if (
        key !== 'ArrowUp' &&
        key !== 'ArrowDown' &&
        key !== 'ArrowLeft' &&
        key !== 'ArrowRight'
      ) {
        return;
      }

      event.preventDefault();
      const delta = event.shiftKey ? 10 : 1;
      const dir = {
        ArrowUp: { x: 0, y: -delta },
        ArrowDown: { x: 0, y: delta },
        ArrowLeft: { x: -delta, y: 0 },
        ArrowRight: { x: delta, y: 0 }
      }[key];

      if (!dir) return;

      if (editMode === 'batch') {
        setSettings((prev) => ({
          ...prev,
          batch: {
            ...prev.batch,
            offsetX: clamp(prev.batch.offsetX + dir.x, -400, 400),
            offsetY: clamp(prev.batch.offsetY + dir.y, -400, 400)
          }
        }));
        return;
      }

      const currentlySelected = selectedItem;
      if (!currentlySelected) return;

      setItems((prev) =>
        prev.map((item) =>
          item.id === currentlySelected.id
            ? {
                ...item,
                overrides: {
                  ...item.overrides,
                  offsetX: clamp(item.overrides.offsetX + dir.x, -300, 300),
                  offsetY: clamp(item.overrides.offsetY + dir.y, -300, 300)
                }
              }
            : item
        )
      );
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editMode, selectedItem, setSettings]);

  useEffect(() => {
    if (items.length === 0) {
      setProgress({
        total: 0,
        processed: 0,
        exporting: false,
        stage: 'idle'
      });
      return;
    }

    const total = items.length;
    const processed = items.filter(
      (item) => item.status === 'ready' || item.status === 'skipped'
    ).length;
    const hasPending = items.some(
      (item) => item.status === 'queued' || item.status === 'processing'
    );

    setProgress((prev) => ({
      total,
      processed,
      exporting: prev.exporting,
      stage: hasPending ? 'removal' : prev.exporting ? 'export' : 'idle'
    }));
  }, [items]);

  const queueNextItem = useCallback(() => {
    if (processingRef.current) return;
    const nextItem = items.find(
      (item) => item.status === 'queued' || (item.status === 'error' && item.retries < 2)
    );
    if (!nextItem) return;

    processingRef.current = true;

    const run = async () => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === nextItem.id ? { ...item, status: 'processing' } : item
        )
      );

      try {
        const base64 = await readFileAsDataUrl(nextItem.file);
        const dimensions = await getImageDimensions(base64).catch(() => null);

        setItems((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? {
                  ...item,
                  previewUrl: (() => {
                    if (item.previewUrl.startsWith('blob:')) {
                      URL.revokeObjectURL(item.previewUrl);
                    }
                    return base64;
                  })(),
                  width: dimensions?.width ?? item.width,
                  height: dimensions?.height ?? item.height
                }
              : item
          )
        );

        const processedBlob = await removeBackgroundFromFile(nextItem.file);
        const processedDataUrl = await blobToDataUrl(processedBlob);

        setItems((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? {
                  ...item,
                  status: 'ready',
                  processedDataUrl,
                  width: dimensions?.width ?? item.width,
                  height: dimensions?.height ?? item.height,
                  errorMessage: undefined
                }
              : item
          )
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '去背處理失敗，請稍後再試';

        setItems((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? {
                  ...item,
                  status: item.retries + 1 >= 2 ? 'error' : 'queued',
                  retries: item.retries + 1,
                  errorMessage: message
                }
              : item
          )
        );
      } finally {
        processingRef.current = false;
      }
    };

    void run();
  }, [items]);

  useEffect(() => {
    queueNextItem();
  }, [items, queueNextItem]);

  useEffect(() => {
    if (!selectedItem || selectedItem.status !== 'ready') return;
    void updateFabricImage(selectedItem, true);
  }, [selectedItem?.status, updateFabricImage]);

  useEffect(() => {
    if (!selectedItem || selectedItem.status !== 'ready') return;
    setProgress((prev) =>
      prev.exporting
        ? prev
        : {
            ...prev,
            stage: 'render'
          }
    );
  }, [selectedItem?.id, selectedItem?.status]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setItems((prev) => {
        const capacity = MAX_FILES - prev.length;
        const accepted = Array.from(files)
          .slice(0, capacity)
          .filter((file) => file.size <= 15 * 1024 * 1024);

        const newItems = accepted.map<AvatarItem>((file) => ({
          id:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          originalName: file.name,
          file,
          status: 'queued',
          retries: 0,
          previewUrl: URL.createObjectURL(file),
          overrides: { ...DEFAULT_OVERRIDES }
        }));

        const combined = [...prev, ...newItems];
        if (!selectedId && combined.length > 0) {
          setSelectedId(newItems[0].id);
        }
        return combined;
      });
    },
    [selectedId]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.dataTransfer?.files) {
        handleFiles(event.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleDelete = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((item) => {
          if (item.id === id && item.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(item.previewUrl);
          }
          return item.id !== id;
        });

        if (selectedId === id) {
          setSelectedId(next[0]?.id ?? null);
        }

        return next;
      });
    },
    [selectedId]
  );

  const handleClearAll = useCallback(() => {
    processingRef.current = false;
    setItems((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
    setSelectedId(null);
    const canvas = fabricCanvasRef.current;
    if (canvas) {
      canvas.clear();
      void loadFabric().then((fabricInstance) => {
        applyBackgroundToCanvas(
          fabricInstance,
          canvas,
          settings.canvas.background
        );
        canvas.clipPath = computeClipPath(
          fabricInstance,
          settings.canvas.size,
          settings.canvas
        );
        canvas.renderAll();
      });
    }
    fabricImageRef.current = null;
  }, [settings.canvas]);

  const retryItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'queued',
              errorMessage: undefined,
              retries: clamp(item.retries, 0, 1)
            }
          : item
      )
    );
  }, []);

  const skipItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'skipped'
            }
          : item
      )
    );
  }, []);

  const exportCanvases = useCallback(async () => {
    if (!fabricCanvasRef.current || items.length === 0) return;

    const canvas = fabricCanvasRef.current;
    const fabricInstance = await loadFabric();
    const readyItems = items.filter((item) => item.status === 'ready');

    setProgress((prev) => ({
      ...prev,
      exporting: true,
      stage: 'export'
    }));

    try {
      const files = await Promise.all(
        readyItems.map(async (item, index) => {
          await updateFabricImage(item);

          if (!canvas.clipPath) {
            canvas.clipPath = computeClipPath(
              fabricInstance,
              settings.canvas.size,
              settings.canvas
            );
          }

          const multiplier = settings.export.scale;
          const dataUrl = canvas.toDataURL({
            format: settings.export.format,
            quality: settings.export.quality,
            multiplier,
            enableRetinaScaling: false
          });

          return {
            name: generateFileName(
              settings.export.namingPattern,
              index,
              item,
              settings.export.format
            ),
            data: dataUrl
          };
        })
      );

      const response = await fetch('/api/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archiveName: 'avatars.zip',
          files
        })
      });

      if (!response.ok) {
        throw new Error('打包 ZIP 失敗');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'avatars.zip';
      anchor.click();
      URL.revokeObjectURL(url);

      setProgress({
        total: items.length,
        processed: readyItems.length,
        exporting: false,
        stage: 'idle'
      });
    } catch (error) {
      setProgress((prev) => ({
        ...prev,
        exporting: false,
        stage: 'idle'
      }));
      throw error;
    }
  }, [items, settings, updateFabricImage]);

  const renderStatusBadge = (item: AvatarItem) => {
    const label =
      item.status === 'ready'
        ? 'OK'
        : item.status === 'processing'
        ? '處理中'
        : item.status === 'queued'
        ? '排隊'
        : item.status === 'skipped'
        ? '略過'
        : '錯誤';
    return (
      <span
        className={twMerge(
          'absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium',
          item.status === 'ready' && 'bg-emerald-500/80 text-emerald-950',
          item.status === 'processing' && 'bg-amber-500/80 text-amber-950',
          item.status === 'queued' && 'bg-slate-500/70 text-slate-100',
          item.status === 'error' && 'bg-rose-500/80 text-rose-50',
          item.status === 'skipped' && 'bg-slate-700/80 text-slate-200'
        )}
      >
        {label}
      </span>
    );
  };

  const handleRangeChange = useCallback(
    (
      key: keyof BatchControls,
      value: number,
      range: { min: number; max: number }
    ) => {
      setSettings((prev) => ({
        ...prev,
        batch: {
          ...prev.batch,
          [key]: clamp(value, range.min, range.max)
        }
      }));
    },
    []
  );

  const handleOverrideChange = useCallback(
    (
      id: string,
      key: keyof ItemOverrides,
      value: number,
      range: { min: number; max: number }
    ) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                overrides: {
                  ...item.overrides,
                  [key]: clamp(value, range.min, range.max)
                }
              }
            : item
        )
      );
    },
    []
  );

  const dropZoneMessage =
    items.length === 0
      ? '拖曳或點擊以上傳至多 50 張照片'
      : `已選擇 ${items.length}/${MAX_FILES} 張照片`;

  return (
    <div className="flex flex-1 bg-slate-950 text-slate-100">
      <aside className="w-64 border-r border-slate-900 bg-slate-950/80">
        <div className="p-4">
          <button
            className="w-full rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-sm font-semibold hover:border-slate-500 hover:bg-slate-700"
            onClick={() => fileInputRef.current?.click()}
          >
            選擇圖片
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={FILE_ACCEPT}
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
        </div>
        <div
          className="mx-3 mb-4 flex h-24 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/60 text-xs text-slate-400"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {dropZoneMessage}
        </div>
        <div className="flex items-center justify-between px-4 pb-2 text-xs text-slate-400">
          <span>素材列表</span>
          <button
            className="text-rose-400 hover:text-rose-300"
            onClick={handleClearAll}
          >
            清空
          </button>
        </div>
        <div className="scrollbar-thin h-[calc(100vh-16rem)] space-y-3 overflow-y-auto px-4 pb-8">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={twMerge(
                'relative block overflow-hidden rounded-xl border text-left transition-all',
                selectedItem?.id === item.id
                  ? 'border-brand-primary shadow-floating'
                  : 'border-slate-800 hover:border-slate-600'
              )}
            >
              <img
                src={item.processedDataUrl ?? item.previewUrl}
                alt={item.originalName}
                className="h-32 w-full object-cover"
              />
              {renderStatusBadge(item)}
              <div className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="line-clamp-1 text-slate-200">
                  {item.originalName}
                </span>
                <button
                  className="text-rose-400 hover:text-rose-200"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDelete(item.id);
                  }}
                >
                  刪除
                </button>
              </div>
              {item.status === 'error' && item.errorMessage && (
                <div className="space-y-2 bg-rose-500/10 px-3 pb-3 text-rose-200">
                  <p className="text-[11px]">{item.errorMessage}</p>
                  <div className="flex gap-2 text-[11px]">
                    <button
                      className="rounded border border-rose-400/40 px-2 py-1 hover:bg-rose-500/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        retryItem(item.id);
                      }}
                    >
                      重試
                    </button>
                    <button
                      className="rounded border border-slate-500/40 px-2 py-1 text-slate-200 hover:bg-slate-700/40"
                      onClick={(event) => {
                        event.stopPropagation();
                        skipItem(item.id);
                      }}
                    >
                      略過
                    </button>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950/70 px-8 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              進度
            </p>
            <p className="text-sm font-semibold text-slate-100">
              {formatProgressLabel(progress)}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              className={twMerge(
                'rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide',
                editMode === 'batch'
                  ? 'bg-brand-primary text-white'
                  : 'bg-slate-800 text-slate-200'
              )}
              onClick={() => setEditMode('batch')}
            >
              批量模式
            </button>
            <button
              className={twMerge(
                'rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide',
                editMode === 'single'
                  ? 'bg-brand-primary text-white'
                  : 'bg-slate-800 text-slate-200'
              )}
              onClick={() => setEditMode('single')}
              disabled={!selectedItem}
            >
              單張模式
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col items-center justify-center bg-slate-950">
            <div
              className="relative flex items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/60 p-10 shadow-inner"
              style={{
                minHeight: 520
              }}
            >
              <canvas
                ref={canvasRef}
                width={settings.canvas.size}
                height={settings.canvas.size}
                className="rounded-3xl bg-slate-950 shadow-xl"
              />
            </div>
            <p className="mt-4 text-xs text-slate-400">
              形狀：{settings.canvas.shape === 'circle' ? '圓形' : '方形'} · 尺寸：
              {settings.canvas.size} px
            </p>
          </div>

          <div className="w-[360px] border-l border-slate-900 bg-slate-950/85 px-6 py-6">
            <div className="space-y-6">
              <section>
                <h2 className="text-sm font-semibold text-slate-200">
                  畫布設定
                </h2>
                <div className="mt-3 space-y-3 text-sm">
                  <label className="flex flex-col gap-1 text-slate-300">
                    尺寸
                    <select
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      value={settings.canvas.size}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          canvas: {
                            ...prev.canvas,
                            size: Number(event.target.value)
                          }
                        }))
                      }
                    >
                      {CANVAS_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size} px
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-2 text-slate-300">
                    形狀
                    <div className="flex gap-2">
                      <button
                        className={twMerge(
                          'flex-1 rounded-lg border px-3 py-2 text-sm',
                          settings.canvas.shape === 'circle'
                            ? 'border-brand-primary bg-brand-primary/20'
                            : 'border-slate-700 bg-slate-900'
                        )}
                        onClick={() =>
                          setSettings((prev) => ({
                            ...prev,
                            canvas: {
                              ...prev.canvas,
                              shape: 'circle'
                            }
                          }))
                        }
                      >
                        圓形
                      </button>
                      <button
                        className={twMerge(
                          'flex-1 rounded-lg border px-3 py-2 text-sm',
                          settings.canvas.shape === 'square'
                            ? 'border-brand-primary bg-brand-primary/20'
                            : 'border-slate-700 bg-slate-900'
                        )}
                        onClick={() =>
                          setSettings((prev) => ({
                            ...prev,
                            canvas: {
                              ...prev.canvas,
                              shape: 'square'
                            }
                          }))
                        }
                      >
                        方形
                      </button>
                    </div>
                  </label>

                  {settings.canvas.shape === 'square' && (
                    <label className="flex flex-col gap-2 text-slate-300">
                      圓角
                      <input
                        type="range"
                        min={0}
                        max={200}
                        step={2}
                        value={settings.canvas.cornerRadius}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            canvas: {
                              ...prev.canvas,
                              cornerRadius: Number(event.target.value)
                            }
                          }))
                        }
                      />
                    </label>
                  )}

                  <div className="space-y-2">
                    <p className="text-slate-300">背景</p>
                    <div className="flex gap-2">
                      {(['transparent', 'color', 'gradient', 'pattern'] as const).map(
                        (mode) => (
                          <button
                            key={mode}
                            className={twMerge(
                              'flex-1 rounded-lg border px-3 py-2 text-xs uppercase tracking-wide',
                              settings.canvas.background.mode === mode
                                ? 'border-brand-primary bg-brand-primary/20'
                                : 'border-slate-700 bg-slate-900 text-slate-300'
                            )}
                            onClick={() =>
                              setSettings((prev) => ({
                                ...prev,
                                canvas: {
                                  ...prev.canvas,
                                  background:
                                    mode === 'transparent'
                                      ? { mode }
                                      : mode === 'color'
                                      ? {
                                          mode,
                                          color:
                                            prev.canvas.background.mode === 'color'
                                              ? prev.canvas.background.color
                                              : '#F5F5F5'
                                        }
                                      : mode === 'gradient'
                                      ? {
                                          mode,
                                          from:
                                            prev.canvas.background.mode ===
                                            'gradient'
                                              ? prev.canvas.background.from
                                              : '#8B5CF6',
                                          to:
                                            prev.canvas.background.mode ===
                                            'gradient'
                                              ? prev.canvas.background.to
                                              : '#EC4899',
                                          angle:
                                            prev.canvas.background.mode ===
                                            'gradient'
                                              ? prev.canvas.background.angle
                                              : 135
                                        }
                                      : {
                                          mode,
                                          preset: 'dots',
                                          colorA:
                                            prev.canvas.background.mode ===
                                            'pattern'
                                              ? prev.canvas.background.colorA
                                              : '#F1F5F9',
                                          colorB:
                                            prev.canvas.background.mode ===
                                            'pattern'
                                              ? prev.canvas.background.colorB
                                              : '#CBD5F5'
                                        }
                                }
                              }))
                            }
                          >
                            {mode.toUpperCase()}
                          </button>
                        )
                      )}
                    </div>

                    {settings.canvas.background.mode === 'color' && (
                      <label className="flex items-center gap-3 text-sm text-slate-300">
                        <span>色碼</span>
                        <input
                          type="color"
                          value={settings.canvas.background.color}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              canvas: {
                                ...prev.canvas,
                                background: {
                                  mode: 'color',
                                  color: event.target.value
                                }
                              }
                            }))
                          }
                        />
                        <input
                          type="text"
                          value={settings.canvas.background.color}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              canvas: {
                                ...prev.canvas,
                                background: {
                                  mode: 'color',
                                  color: event.target.value
                                }
                              }
                            }))
                          }
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                        />
                      </label>
                    )}

                    {settings.canvas.background.mode === 'gradient' && (
                      <div className="space-y-3 text-xs text-slate-300">
                        <label className="flex items-center gap-2">
                          <span>起始</span>
                          <input
                            type="color"
                            value={settings.canvas.background.from}
                            onChange={(event) =>
                              setSettings((prev) => ({
                                ...prev,
                                canvas: {
                                  ...prev.canvas,
                                  background: {
                                    ...prev.canvas.background,
                                    from: event.target.value,
                                    mode: 'gradient'
                                  }
                                }
                              }))
                            }
                          />
                        </label>
                        <label className="flex items-center gap-2">
                          <span>結束</span>
                          <input
                            type="color"
                            value={settings.canvas.background.to}
                            onChange={(event) =>
                              setSettings((prev) => ({
                                ...prev,
                                canvas: {
                                  ...prev.canvas,
                                  background: {
                                    ...prev.canvas.background,
                                    to: event.target.value,
                                    mode: 'gradient'
                                  }
                                }
                              }))
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          角度 {settings.canvas.background.angle}°
                          <input
                            type="range"
                            min={0}
                            max={360}
                            value={settings.canvas.background.angle}
                            onChange={(event) =>
                              setSettings((prev) => ({
                                ...prev,
                                canvas: {
                                  ...prev.canvas,
                                  background: {
                                    ...prev.canvas.background,
                                    angle: Number(event.target.value),
                                    mode: 'gradient'
                                  }
                                }
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}

                    {settings.canvas.background.mode === 'pattern' && (
                      <div className="space-y-3 text-xs text-slate-300">
                        <div className="flex gap-2">
                          {(['dots', 'grid'] as const).map((preset) => (
                            <button
                              key={preset}
                              className={twMerge(
                                'flex-1 rounded-lg border px-3 py-2 text-xs uppercase tracking-wide',
                                settings.canvas.background.preset === preset
                                  ? 'border-brand-primary bg-brand-primary/20'
                                  : 'border-slate-700 bg-slate-900 text-slate-300'
                              )}
                              onClick={() =>
                                setSettings((prev) => ({
                                  ...prev,
                                  canvas: {
                                    ...prev.canvas,
                                    background: {
                                      ...prev.canvas.background,
                                      preset,
                                      mode: 'pattern'
                                    }
                                  }
                                }))
                              }
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                        <label className="flex items-center gap-2">
                          <span>底色</span>
                          <input
                            type="color"
                            value={settings.canvas.background.colorA}
                            onChange={(event) =>
                              setSettings((prev) => ({
                                ...prev,
                                canvas: {
                                  ...prev.canvas,
                                  background: {
                                    ...prev.canvas.background,
                                    colorA: event.target.value,
                                    mode: 'pattern'
                                  }
                                }
                              }))
                            }
                          />
                        </label>
                        <label className="flex items-center gap-2">
                          <span>圖樣</span>
                          <input
                            type="color"
                            value={settings.canvas.background.colorB}
                            onChange={(event) =>
                              setSettings((prev) => ({
                                ...prev,
                                canvas: {
                                  ...prev.canvas,
                                  background: {
                                    ...prev.canvas.background,
                                    colorB: event.target.value,
                                    mode: 'pattern'
                                  }
                                }
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="border-t border-slate-900 pt-6">
                <h2 className="text-sm font-semibold text-slate-200">
                  批量控制
                </h2>
                <div className="mt-4 space-y-4 text-sm">
                  <label className="flex flex-col gap-2">
                    縮放 {Math.round(settings.batch.scale * 100)}%
                    <input
                      type="range"
                      min={0.3}
                      max={1.5}
                      step={0.01}
                      value={settings.batch.scale}
                      onChange={(event) =>
                        handleRangeChange('scale', Number(event.target.value), {
                          min: 0.3,
                          max: 1.5
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    旋轉 {settings.batch.rotate}°
                    <input
                      type="range"
                      min={-45}
                      max={45}
                      step={1}
                      value={settings.batch.rotate}
                      onChange={(event) =>
                        handleRangeChange('rotate', Number(event.target.value), {
                          min: -45,
                          max: 45
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    X 偏移 {settings.batch.offsetX}px
                    <input
                      type="range"
                      min={-300}
                      max={300}
                      step={1}
                      value={settings.batch.offsetX}
                      onChange={(event) =>
                        handleRangeChange(
                          'offsetX',
                          Number(event.target.value),
                          { min: -300, max: 300 }
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    Y 偏移 {settings.batch.offsetY}px
                    <input
                      type="range"
                      min={-300}
                      max={300}
                      step={1}
                      value={settings.batch.offsetY}
                      onChange={(event) =>
                        handleRangeChange(
                          'offsetY',
                          Number(event.target.value),
                          { min: -300, max: 300 }
                        )
                      }
                    />
                  </label>
                </div>
              </section>

              {editMode === 'single' && selectedItem && (
                <section className="border-t border-slate-900 pt-6">
                  <h2 className="text-sm font-semibold text-slate-200">
                    單張調整
                  </h2>
                  <div className="mt-4 space-y-4 text-sm">
                    <label className="flex flex-col gap-2">
                      縮放 {Math.round(selectedItem.overrides.scale * 100)}%
                      <input
                        type="range"
                        min={0.7}
                        max={1.4}
                        step={0.01}
                        value={selectedItem.overrides.scale}
                        onChange={(event) =>
                          handleOverrideChange(
                            selectedItem.id,
                            'scale',
                            Number(event.target.value),
                            { min: 0.7, max: 1.4 }
                          )
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      旋轉 {selectedItem.overrides.rotate}°
                      <input
                        type="range"
                        min={-30}
                        max={30}
                        step={1}
                        value={selectedItem.overrides.rotate}
                        onChange={(event) =>
                          handleOverrideChange(
                            selectedItem.id,
                            'rotate',
                            Number(event.target.value),
                            { min: -30, max: 30 }
                          )
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      X 偏移 {selectedItem.overrides.offsetX}px
                      <input
                        type="range"
                        min={-200}
                        max={200}
                        step={1}
                        value={selectedItem.overrides.offsetX}
                        onChange={(event) =>
                          handleOverrideChange(
                            selectedItem.id,
                            'offsetX',
                            Number(event.target.value),
                            { min: -200, max: 200 }
                          )
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      Y 偏移 {selectedItem.overrides.offsetY}px
                      <input
                        type="range"
                        min={-200}
                        max={200}
                        step={1}
                        value={selectedItem.overrides.offsetY}
                        onChange={(event) =>
                          handleOverrideChange(
                            selectedItem.id,
                            'offsetY',
                            Number(event.target.value),
                            { min: -200, max: 200 }
                          )
                        }
                      />
                    </label>
                  </div>
                </section>
              )}

              <section className="border-t border-slate-900 pt-6">
                <h2 className="text-sm font-semibold text-slate-200">
                  導出設定
                </h2>
                <div className="mt-4 space-y-4 text-sm">
                  <label className="flex flex-col gap-2">
                    格式
                    <select
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      value={settings.export.format}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          export: {
                            ...prev.export,
                            format: event.target.value as 'png' | 'webp'
                          }
                        }))
                      }
                    >
                      <option value="png">PNG</option>
                      <option value="webp">WebP</option>
                    </select>
                  </label>
                  {settings.export.format === 'webp' && (
                    <label className="flex flex-col gap-2">
                      品質 {Math.round(settings.export.quality * 100)}
                      <input
                        type="range"
                        min={0.5}
                        max={0.95}
                        step={0.01}
                        value={settings.export.quality}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            export: {
                              ...prev.export,
                              quality: Number(event.target.value)
                            }
                          }))
                        }
                      />
                    </label>
                  )}
                  <label className="flex flex-col gap-2">
                    解析度倍率
                    <select
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      value={settings.export.scale}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          export: {
                            ...prev.export,
                            scale: Number(
                              event.target.value
                            ) as ExportOptions['scale']
                          }
                        }))
                      }
                    >
                      <option value={1}>1x</option>
                      <option value={2}>2x</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    檔名規則
                    <input
                      type="text"
                      value={settings.export.namingPattern}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          export: {
                            ...prev.export,
                            namingPattern: event.target.value
                          }
                        }))
                      }
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                    />
                    <span className="text-xs text-slate-500">
                      可使用 &#123;index&#125;、&#123;origName&#125;、&#123;timestamp&#125;
                    </span>
                  </label>
                  <button
                    className="w-full rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700/60"
                    disabled={
                      progress.exporting ||
                      items.filter((item) => item.status === 'ready').length === 0
                    }
                    onClick={() => {
                      void exportCanvases().catch((error) =>
                        alert(
                          error instanceof Error
                            ? error.message
                            : '導出失敗，請稍後再試'
                        )
                      );
                    }}
                  >
                    一鍵導出
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Workspace;
