import { useEffect, useState } from "react";
import type { LaunchItem, RunMode } from "@/types/config";
import { pickExeFile, pickFolder, pickIcon } from "@/lib/ipc";
import { useItemIcon } from "@/lib/useIcon";
import IconPickerDialog from "@/components/IconPickerDialog";

interface Props {
  /** 要编辑的 item。若 target/name 都为空，视为"新建"模式 */
  item: LaunchItem;
  onOk: (next: LaunchItem) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export default function EditItemDialog({ item, onOk, onCancel, onDelete }: Props) {
  const [tab, setTab] = useState<"file" | "appearance">("file");
  // 规范化：所有字符串字段若为 undefined/null，一律兜底为空串，保证 input 受控不变形
  const normalize = (i: LaunchItem): LaunchItem => ({
    key: i.key ?? "",
    name: i.name ?? "",
    target: i.target ?? "",
    arguments: i.arguments ?? "",
    startIn: i.startIn ?? "",
    run: i.run ?? "normal",
    runAsAdmin: !!i.runAsAdmin,
    iconMode: i.iconMode ?? "default",
    iconPath: i.iconPath ?? "",
    iconIndex: i.iconIndex ?? 0,
  });
  const [draft, setDraft] = useState<LaunchItem>(() => normalize(item));

  useEffect(() => setDraft(normalize(item)), [item]);

  // 用 draft 判断"是否新建"，避免 props.item 引用 stale 时显示错乱
  const isNew = !draft.name && !draft.target;

  const update = <K extends keyof LaunchItem>(key: K, value: LaunchItem[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="panel w-[640px] max-w-[92vw] p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 h-9 border-b border-white/10">
          <div className="text-sm text-white/90 truncate pr-2">
            {isNew ? "新建" : "编辑"}命令 · 键位 {draft.key || item.key}
            {!isNew && (
              <span className="text-white/45 text-xs ml-2">
                ({draft.name || draft.target.slice(0, 40)})
              </span>
            )}
          </div>
          <button
            className="w-6 h-6 rounded hover:bg-white/15 text-white/80"
            onClick={onCancel}
            title="取消"
          >
            ×
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex items-center gap-1 px-3 pt-2 border-b border-white/10">
          <TabBtn active={tab === "file"} onClick={() => setTab("file")}>
            File
          </TabBtn>
          <TabBtn active={tab === "appearance"} onClick={() => setTab("appearance")}>
            Appearance
          </TabBtn>
        </div>

        {/* 内容 */}
        <div className="p-4 space-y-3 text-sm">
          {tab === "file" ? (
            <FilePane draft={draft} update={update} />
          ) : (
            <AppearancePane draft={draft} update={update} />
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
          <div>
            {!isNew && onDelete && (
              <button
                className="px-3 py-1 rounded text-xs text-red-400 hover:bg-red-500/15"
                onClick={() => {
                  if (confirm(`确认删除 "${item.name || item.key}" ?`)) {
                    onDelete();
                  }
                }}
              >
                删除
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/15 text-sm"
              onClick={onCancel}
            >
              取消
            </button>
            <button
              className="px-4 py-1.5 rounded bg-blue-500/90 hover:bg-blue-500 text-white text-sm"
              onClick={() => {
                if (!draft.target.trim()) {
                  alert("请填写 Target（目标路径/URL）");
                  return;
                }
                onOk({ ...draft, name: draft.name.trim() || baseName(draft.target) });
              }}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`px-3 py-1 text-xs rounded-t ${
        active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FilePane({
  draft,
  update,
}: {
  draft: LaunchItem;
  update: <K extends keyof LaunchItem>(key: K, value: LaunchItem[K]) => void;
}) {
  return (
    <>
      <Row label="Name">
        <input
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 outline-none focus:border-blue-400/60"
          value={draft.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="显示名称（留空自动取目标文件名）"
        />
      </Row>

      <Row label="Target">
        <input
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 outline-none focus:border-blue-400/60"
          value={draft.target}
          onChange={(e) => update("target", e.target.value)}
          placeholder="exe 路径 / https URL / 文件夹路径"
        />
        <button
          className="px-2 py-1 text-xs bg-white/10 hover:bg-white/15 rounded"
          onClick={async () => {
            const p = await pickExeFile();
            if (p) {
              update("target", p);
              // 自动填 Start in
              if (!draft.startIn) {
                const dir = p.replace(/[\\/][^\\/]+$/, "");
                if (dir !== p) update("startIn", dir);
              }
            }
          }}
        >
          Browse File
        </button>
        <button
          className="px-2 py-1 text-xs bg-white/10 hover:bg-white/15 rounded"
          onClick={async () => {
            const p = await pickFolder();
            if (p) update("target", p);
          }}
        >
          Browse Folder
        </button>
      </Row>

      <Row label="Arguments">
        <input
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 outline-none focus:border-blue-400/60"
          value={draft.arguments}
          onChange={(e) => update("arguments", e.target.value)}
          placeholder="启动参数，可留空"
        />
      </Row>

      <Row label="Start in">
        <input
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 outline-none focus:border-blue-400/60"
          value={draft.startIn}
          onChange={(e) => update("startIn", e.target.value)}
          placeholder="工作目录，留空自动取 Target 所在目录"
        />
        <button
          className="px-2 py-1 text-xs bg-white/10 hover:bg-white/15 rounded"
          onClick={async () => {
            const p = await pickFolder();
            if (p) update("startIn", p);
          }}
        >
          Browse Folder
        </button>
      </Row>

      <Row label="Run">
        <select
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 outline-none focus:border-blue-400/60"
          value={draft.run}
          onChange={(e) => update("run", e.target.value as RunMode)}
        >
          <option value="normal">Normal window</option>
          <option value="minimized">Minimized</option>
          <option value="maximized">Maximized</option>
          <option value="hidden">Hidden (后台运行)</option>
        </select>
      </Row>

      <Row label="">
        <label className="flex items-center gap-2 text-white/85 cursor-pointer">
          <input
            type="checkbox"
            className="accent-blue-500"
            checked={draft.runAsAdmin}
            onChange={(e) => update("runAsAdmin", e.target.checked)}
          />
          Run as administrator
        </label>
      </Row>

      <div className="text-xs text-white/50 pt-1">
        提示：M3 会加入图标自动提取、拖拽添加与自定义图标。
      </div>
    </>
  );
}

function AppearancePane({
  draft,
  update,
}: {
  draft: LaunchItem;
  update: <K extends keyof LaunchItem>(key: K, value: LaunchItem[K]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // 使用现有 useItemIcon 拿到当前图标 URL
  const iconUrl = useItemIcon(draft);

  const isDefault = draft.iconMode === "default";
  const isCustom = draft.iconMode === "custom";
  const isResource = draft.iconMode === "resource";

  return (
    <>
      <div className="flex items-start gap-4">
        {/* 大图标预览 */}
        <button
          className={`shrink-0 w-20 h-20 rounded-md border ${
            isResource ? "border-blue-400/60" : "border-white/15"
          } bg-black/30 flex items-center justify-center hover:border-blue-400/60`}
          title="点击从 .dll/.exe 选择图标"
          onClick={() => setPickerOpen(true)}
        >
          {iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              className="object-contain"
              style={{ width: 56, height: 56 }}
              draggable={false}
            />
          ) : (
            <span className="text-white/30 text-xs">无图标</span>
          )}
        </button>

        {/* 模式切换 + 操作 */}
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <ModeBtn
              active={isDefault}
              onClick={() =>
                update("iconMode", "default")
              }
            >
              Default Icon
            </ModeBtn>
            <ModeBtn
              active={isCustom}
              onClick={async () => {
                const p = await pickIcon();
                if (p) {
                  update("iconMode", "custom");
                  update("iconPath", p);
                }
              }}
            >
              Custom Icon (图片)
            </ModeBtn>
            <ModeBtn
              active={isResource}
              onClick={() => setPickerOpen(true)}
            >
              Change Icon (DLL/EXE)
            </ModeBtn>
          </div>

          <div className="text-xs text-white/55 space-y-0.5">
            {isDefault && (
              <div>由 Target 自动派生（Shell 默认图标）。</div>
            )}
            {isCustom && (
              <>
                <div>使用本地图片文件作为图标。</div>
                <div className="font-mono text-white/65 break-all">
                  {draft.iconPath || "<未选择>"}
                </div>
              </>
            )}
            {isResource && (
              <>
                <div>从 PE 资源（.dll/.exe）中提取指定 index 的图标。</div>
                <div className="font-mono text-white/65 break-all">
                  {draft.iconPath || "<未选择>"}{" "}
                  <span className="text-blue-300">#{draft.iconIndex || 0}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-white/40 border-t border-white/10 pt-2 mt-1">
        提示：3 种模式互斥。Default 跟随 Target；Custom 使用任意图片；
        Change 用 Windows 标准方式从 system32\\shell32.dll
        等资源文件挑选系统图标。
      </div>

      {pickerOpen && (
        <IconPickerDialog
          initialFile={
            isResource && draft.iconPath
              ? draft.iconPath
              : "C:\\Windows\\System32\\shell32.dll"
          }
          initialIndex={isResource ? draft.iconIndex || 0 : 0}
          onCancel={() => setPickerOpen(false)}
          onOk={(file, index) => {
            update("iconMode", "resource");
            update("iconPath", file);
            update("iconIndex", index);
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`px-3 py-1 text-xs rounded ${
        active
          ? "bg-blue-500/80 text-white"
          : "bg-white/10 hover:bg-white/15 text-white/85"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 text-right text-white/80 text-sm">{label}</div>
      {children}
    </div>
  );
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const sep = trimmed.lastIndexOf("\\") !== -1 ? "\\" : "/";
  const last = trimmed.split(sep).pop() || trimmed;
  return last.replace(/\.[^.]+$/, "");
}

