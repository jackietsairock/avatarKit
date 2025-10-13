import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { fabric } from 'fabric';
import { loadFabric } from '../utils/fabricLoader';
import {
  blobToDataUrl,
  enhanceIfNeeded,
  measureImage,
  removeBackground
} from '../utils/imageProcessing';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { v4 as uuid } from 'uuid';
import tinycolor from 'tinycolor2';

const OUTPUT_WIDTH = 689;
const OUTPUT_HEIGHT = 688;
const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp';

const DEFAULT_OVERRIDES = {
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0
};

const DEFAULT_BACKGROUND = '#1e293b';

const SCALE_RANGE = { min: 0.6, max: 1.6 };
const OFFSET_RANGE = { min: -220, max: 220 };
const ROTATE_RANGE = { min: -30, max: 30 };

const MAX_FILES = 50;

interface ItemOverrides {
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
}

type AvatarStatus =
  | 'pending'
  | 'enhancing'
  | 'removing'
  | 'ready'
  | 'error';

interface AvatarItem {
  id: string;
  file: File;
  originalName: string;
  previewUrl: string;
  processedUrl?: string;
  backgroundColor: string;
  overrides: ItemOverrides;
  status: AvatarStatus;
  errorMessage?: string;
  width?: number;
  height?: number;
}

interface FabricRefs {
  canvas: fabric.Canvas | null;
  image: fabric.Image | null;
}

type FabricNamespace = Awaited<ReturnType<typeof loadFabric>>;

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

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const Workspace: React.FC = () => {
  const [items, setItems] = useState<AvatarItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const refs = useRef<FabricRefs>({ canvas: null, image: null });
  const currentSourceRef = useRef<string | null>(null);
  const currentDimensionsRef = useRef<{ width: number; height: number } | null>(
    null
  );
  const imageLoadTokenRef = useRef(0);
  const processingRef = useRef(false);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  );

  const setupCanvas = useCallback(async () => {
    const fabricInstance = await loadFabric();
    const existing = refs.current.canvas;
    if (existing) {
      existing.clear();
      existing.dispose();
    }

    const canvasElement = document.createElement('canvas');
    canvasElement.width = OUTPUT_WIDTH;
    canvasElement.height = OUTPUT_HEIGHT;

    const container = document.getElementById('avatar-canvas-host');
    if (!container) return;

    container.innerHTML = '';
    container.appendChild(canvasElement);

    const canvas = new fabricInstance.Canvas(canvasElement, {
      selection: false,
      backgroundColor: DEFAULT_BACKGROUND,
      fireRightClick: false,
      controlsAboveOverlay: true
    });

    canvas.setWidth(OUTPUT_WIDTH);
    canvas.setHeight(OUTPUT_HEIGHT);

    canvas.clipPath = new fabricInstance.Circle({
      radius: Math.min(OUTPUT_WIDTH, OUTPUT_HEIGHT) / 2,
      left: OUTPUT_WIDTH / 2,
      top: OUTPUT_HEIGHT / 2,
      originX: 'center',
      originY: 'center',
      absolutePositioned: true
    });

    refs.current.canvas = canvas;
    refs.current.image = null;
  }, []);

  useEffect(() => {
    void setupCanvas();
    return () => {
      refs.current.canvas?.dispose();
      refs.current.canvas = null;
      refs.current.image = null;
    };
  }, [setupCanvas]);

  const applyBackground = useCallback((item: AvatarItem | null) => {
    if (!refs.current.canvas) return;
    const canvas = refs.current.canvas;
    const color = tinycolor(item?.backgroundColor ?? DEFAULT_BACKGROUND)
      .toHexString()
      .toLowerCase();

    (canvas as fabric.Canvas & {
      backgroundColor?: string;
      requestRenderAll?: () => void;
    }).backgroundColor = color;

    if (typeof canvas.requestRenderAll === 'function') {
      canvas.requestRenderAll();
    } else {
      canvas.renderAll();
    }
  }, []);

  const updateCanvasImage = useCallback(
    async (item: AvatarItem | null) => {
      const canvas = refs.current.canvas;
      if (!canvas) return;

      const activeImage = refs.current.image;
      canvas.getObjects().forEach((object) => {
        if (
          (object as { type?: string }).type?.toLowerCase() === 'image' &&
          object !== activeImage
        ) {
          canvas.remove(object);
        }
      });

      if (!item) {
        if (refs.current.image) {
          canvas.remove(refs.current.image);
          refs.current.image = null;
          canvas.renderAll();
        }
        currentSourceRef.current = null;
        currentDimensionsRef.current = null;
        return;
      }

      const source = item.processedUrl ?? item.previewUrl;
      if (!source) {
        return;
      }

      applyBackground(item);

      const existing = refs.current.image;
      const isSameSource =
        !!existing && currentSourceRef.current === source;

      const applyTransform = (
        image: fabric.Image,
        width: number,
        height: number
      ) => {
        const baseScale = Math.min(OUTPUT_WIDTH / width, OUTPUT_HEIGHT / height);
        const overrideScale = clamp(
          item.overrides.scale,
          SCALE_RANGE.min,
          SCALE_RANGE.max
        );
        const scale = baseScale * overrideScale;

        image.set({
          originX: 'center',
          originY: 'center',
          left: OUTPUT_WIDTH / 2 + item.overrides.offsetX,
          top: OUTPUT_HEIGHT / 2 + item.overrides.offsetY,
          angle: item.overrides.rotation,
          selectable: false,
          evented: false,
          scaleX: scale,
          scaleY: scale
        });

        if (image.canvas) {
          image.setCoords();
        }
      };

      if (isSameSource && existing) {
        const width =
          item.width ??
          currentDimensionsRef.current?.width ??
          existing.width ??
          OUTPUT_WIDTH;
        const height =
          item.height ??
          currentDimensionsRef.current?.height ??
          existing.height ??
          OUTPUT_HEIGHT;

        applyTransform(existing, width, height);
        currentDimensionsRef.current = { width, height };
        currentSourceRef.current = source;
        if (typeof canvas.requestRenderAll === 'function') {
          canvas.requestRenderAll();
        } else {
          canvas.renderAll();
        }
        return;
      }

      const loadToken = imageLoadTokenRef.current + 1;
      imageLoadTokenRef.current = loadToken;

      const fabricInstance = await loadFabric();
      const fromURL = fabricInstance.Image.fromURL.bind(
        fabricInstance.Image
      );

      const image = await (async () => {
        if (fromURL.length <= 2) {
          return fromURL(source, {
            crossOrigin: 'anonymous'
          });
        }

        return new Promise<fabric.Image | null>((resolve) => {
          fromURL(
            source,
            (img: fabric.Image | null) => resolve(img),
            {
              crossOrigin: 'anonymous'
            }
          );
        });
      })();

      if (!image) return;

      if (imageLoadTokenRef.current !== loadToken) {
        return;
      }

      if (existing) {
        canvas.remove(existing);
      }

      const width =
        item.width ??
        image.width ??
        currentDimensionsRef.current?.width ??
        OUTPUT_WIDTH;
      const height =
        item.height ??
        image.height ??
        currentDimensionsRef.current?.height ??
        OUTPUT_HEIGHT;

      applyTransform(image, width, height);

      currentSourceRef.current = source;
      currentDimensionsRef.current = { width, height };
      refs.current.image = image;
      canvas.add(image);
      canvas.getObjects().forEach((object) => {
        if (
          (object as { type?: string }).type?.toLowerCase() === 'image' &&
          object !== image
        ) {
          canvas.remove(object);
        }
      });
      image.setCoords();
      if (typeof canvas.requestRenderAll === 'function') {
        canvas.requestRenderAll();
      } else {
        canvas.renderAll();
      }
    },
    [applyBackground]
  );

  const queueNextItem = useCallback(() => {
    if (processingRef.current) return;

    const nextItem = items.find((item) => item.status === 'pending');
    if (!nextItem) return;

    processingRef.current = true;

    const process = async () => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === nextItem.id
            ? { ...item, status: 'enhancing', errorMessage: undefined }
            : item
        )
      );

      try {
        const baseDataUrl = await readFileAsDataUrl(nextItem.file);
        const enhancedDataUrl = await enhanceIfNeeded(baseDataUrl, 720);

        setItems((prev) =>
          prev.map((item) => {
            if (item.id !== nextItem.id) return item;

            if (item.previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(item.previewUrl);
            }

            return {
              ...item,
              previewUrl: enhancedDataUrl,
              status: 'removing'
            };
          })
        );

        const enhancedBlob = await dataUrlToBlob(enhancedDataUrl);
        const removedBlob = await removeBackground(enhancedBlob);
        const processedUrl = await blobToDataUrl(removedBlob);
        const { width, height } = await measureImage(processedUrl);

        setItems((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? {
                  ...item,
                  status: 'ready',
                  processedUrl,
                  width,
                  height
                }
              : item
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : '處理失敗，請稍後再試';
        setItems((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? {
                  ...item,
                  status: 'error',
                  errorMessage: message
                }
              : item
          )
        );
      } finally {
        processingRef.current = false;
      }
    };

    void process();
  }, [items]);

  useEffect(() => {
    queueNextItem();
  }, [items, queueNextItem]);

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList).filter((file) =>
      ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    );

    if (files.length === 0) return;

    setItems((prev) => {
      const remaining = MAX_FILES - prev.length;
      const toUse = files.slice(0, remaining);
      const newItems = toUse.map<AvatarItem>((file) => ({
        id: uuid(),
        file,
        originalName: file.name,
        previewUrl: URL.createObjectURL(file),
        backgroundColor: DEFAULT_BACKGROUND,
        overrides: { ...DEFAULT_OVERRIDES },
        status: 'pending'
      }));

      const merged = [...prev, ...newItems];
      if (!selectedId && merged.length > 0) {
        setSelectedId(newItems[0]?.id ?? null);
      }
      return merged;
    });
  }, [selectedId]);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.dataTransfer?.files) {
        handleFiles(event.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleRemove = useCallback((id: string) => {
    let removedItem: AvatarItem | undefined;
    let fallbackSelection: string | null = null;

    setItems((prev) => {
      const next: AvatarItem[] = [];
      for (const item of prev) {
        if (item.id === id) {
          removedItem = item;
          continue;
        }
        if (!fallbackSelection) {
          fallbackSelection = item.id;
        }
        next.push(item);
      }
      return next;
    });

    if (removedItem) {
      if (removedItem.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(removedItem.previewUrl);
      }
      if (removedItem.processedUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(removedItem.processedUrl);
      }
    }

    setSelectedId((prev) => (prev === id ? fallbackSelection : prev));
  }, []);

  const updateOverrides = useCallback(
    (id: string, key: keyof ItemOverrides, value: number) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                overrides: {
                  ...item.overrides,
                  [key]: value
                }
              }
            : item
        )
      );
    },
    []
  );

  useEffect(() => {
    void updateCanvasImage(selectedItem ?? null);
  }, [items, selectedItem, updateCanvasImage]);

  const renderItemStatus = (status: AvatarStatus) => {
    switch (status) {
      case 'pending':
        return '排隊';
      case 'enhancing':
        return '增強影像';
      case 'removing':
        return '去背中';
      case 'ready':
        return '就緒';
      case 'error':
        return '錯誤';
      default:
        return '狀態未知';
    }
  };

  const renderCanvasToBlob = async (item: AvatarItem): Promise<Blob> => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.crossOrigin = 'anonymous';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('載入圖片失敗'));
      element.src = item.processedUrl ?? item.previewUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('無法建立畫布上下文');

    ctx.fillStyle = item.backgroundColor ?? DEFAULT_BACKGROUND;
    ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    ctx.save();
    ctx.beginPath();
    ctx.arc(OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2, OUTPUT_HEIGHT / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const baseScale = Math.min(
      OUTPUT_WIDTH / img.naturalWidth,
      OUTPUT_HEIGHT / img.naturalHeight
    );
    const scale = baseScale * item.overrides.scale;
    const rotation = (item.overrides.rotation * Math.PI) / 180;

    ctx.translate(
      OUTPUT_WIDTH / 2 + item.overrides.offsetX,
      OUTPUT_HEIGHT / 2 + item.overrides.offsetY
    );
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('輸出圖片失敗'));
        }
      }, 'image/png');
    });
  };

  const downloadAll = useCallback(async () => {
    const readyItems = items.filter((item) => item.status === 'ready');
    if (readyItems.length === 0) return;
    setIsBusy(true);

    try {
      const zip = new JSZip();

      for (let index = 0; index < readyItems.length; index += 1) {
        const item = readyItems[index];
        const blob = await renderCanvasToBlob(item);
        const fileName = `${String(index + 1).padStart(2, '0')}_${item.originalName
          .replace(/\.[^/.]+$/, '')
          .replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
        zip.file(fileName, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `avatar-kit-${Date.now()}.zip`);
    } catch (error) {
      console.error('打包失敗', error);
      alert('打包失敗，請稍後再試');
    } finally {
      setIsBusy(false);
    }
  }, [items]);

  return (
    <div className="flex w-full max-w-6xl flex-1 gap-6">
      <aside className="flex w-full max-w-xs flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <button
          className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm font-semibold hover:border-slate-500 hover:bg-slate-700"
          onClick={() => fileInputRef.current?.click()}
        >
          選擇照片
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <div
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 px-4 py-6 text-center text-xs text-slate-400"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <p>拖曳或點擊以上傳至多 {MAX_FILES} 張照片</p>
          <p className="text-[11px] text-slate-500">支援 PNG / JPEG / WebP</p>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>素材列表</span>
          <span>
            {items.length}/{MAX_FILES}
          </span>
        </div>
        <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto pr-1">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex flex-col gap-3 rounded-xl border p-3 transition-all ${
                selectedItem?.id === item.id
                  ? 'border-emerald-400/60 bg-emerald-500/10'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'
              }`}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedId(item.id);
                }
              }}
            >
              <div className="flex items-center gap-3">
                <img
                  src={item.processedUrl ?? item.previewUrl}
                  alt={item.originalName}
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
                <div className="flex flex-1 flex-col text-xs">
                  <span className="truncate font-medium text-slate-100">
                    {item.originalName}
                  </span>
                  <span className="text-slate-400">{renderItemStatus(item.status)}</span>
                  {item.errorMessage && (
                    <span className="text-rose-400">{item.errorMessage}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-rose-500/60 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemove(item.id);
                  }}
                >
                  刪除
                </button>
              </div>
              <label className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-300">背景顏色</span>
                <input
                  type="color"
                  value={item.backgroundColor}
                  onChange={(event) =>
                    setItems((prev) =>
                      prev.map((candidate) =>
                        candidate.id === item.id
                          ? { ...candidate, backgroundColor: event.target.value }
                          : candidate
                      )
                    )
                  }
                  className="h-8 w-16 cursor-pointer rounded border border-slate-700"
                />
              </label>
            </div>
          ))}
          {items.length === 0 && (
            <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-center text-xs text-slate-400">
              尚未選擇圖片，請拖曳或點擊上傳。
            </p>
          )}
        </div>
        <button
          className="mt-2 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-900 enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700/60"
          disabled={items.every((item) => item.status !== 'ready') || isBusy}
          onClick={() => {
            void downloadAll();
          }}
        >
          {isBusy ? '打包中...' : '下載全部 PNG (ZIP)'}
        </button>
      </aside>

      <section className="flex flex-1 flex-col gap-6">
        <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">預覽</h2>
              <p className="text-xs text-slate-400">
                拖曳滑桿或調整數值來微調每張頭像。
              </p>
            </div>
            {selectedItem && (
              <span className="text-xs text-slate-400">
                狀態：{renderItemStatus(selectedItem.status)}
              </span>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-6 md:flex-row">
            <div className="flex flex-1 items-center justify-center">
              <div
                id="avatar-canvas-host"
                className="flex aspect-[689/688] w-full max-w-[420px] items-center justify-center overflow-hidden rounded-[48px] border border-slate-800 bg-slate-900"
              />
            </div>

            <div className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
              <h3 className="text-sm font-semibold text-slate-200">圖像調整</h3>

              {selectedItem ? (
                <>
                  <label className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>縮放</span>
                      <span>{Math.round(selectedItem.overrides.scale * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={SCALE_RANGE.min}
                      max={SCALE_RANGE.max}
                      step={0.01}
                      value={selectedItem.overrides.scale}
                      onChange={(event) =>
                        updateOverrides(
                          selectedItem.id,
                          'scale',
                          Number(event.target.value)
                        )
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>旋轉</span>
                      <span>{selectedItem.overrides.rotation}°</span>
                    </div>
                    <input
                      type="range"
                      min={ROTATE_RANGE.min}
                      max={ROTATE_RANGE.max}
                      step={1}
                      value={selectedItem.overrides.rotation}
                      onChange={(event) =>
                        updateOverrides(
                          selectedItem.id,
                          'rotation',
                          Number(event.target.value)
                        )
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>X 偏移</span>
                      <span>{selectedItem.overrides.offsetX}px</span>
                    </div>
                    <input
                      type="range"
                      min={OFFSET_RANGE.min}
                      max={OFFSET_RANGE.max}
                      step={1}
                      value={selectedItem.overrides.offsetX}
                      onChange={(event) =>
                        updateOverrides(
                          selectedItem.id,
                          'offsetX',
                          Number(event.target.value)
                        )
                      }
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>Y 偏移</span>
                      <span>{selectedItem.overrides.offsetY}px</span>
                    </div>
                    <input
                      type="range"
                      min={OFFSET_RANGE.min}
                      max={OFFSET_RANGE.max}
                      step={1}
                      value={selectedItem.overrides.offsetY}
                      onChange={(event) =>
                        updateOverrides(
                          selectedItem.id,
                          'offsetY',
                          Number(event.target.value)
                        )
                      }
                    />
                  </label>
                </>
              ) : (
                <p className="text-xs text-slate-400">
                  尚未選取素材，請從左側列表中選擇一張照片開始編輯。
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Workspace;
