import Workspace from './components/Workspace';

const App: React.FC = () => {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-8 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Avatar Studio</h1>
            <p className="text-sm text-slate-300">
              批量去背、調色與導出的智慧頭像工作室。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            <span>輸出尺寸：689 × 688 px</span>
            <span>支援：PNG / JPEG / WebP</span>
          </div>
        </div>
      </header>
      <main className="flex flex-1 justify-center overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
        <Workspace />
      </main>
    </div>
  );
};

export default App;
