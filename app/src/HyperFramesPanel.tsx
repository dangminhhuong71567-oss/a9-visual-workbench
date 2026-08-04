import {useEffect, useRef, useState} from "react";
import type {Asset} from "@ajiunotes/contracts";
import {api, type HyperFramesSource} from "./api";

type Props = {
  projectId: string;
  fps: number;
  onAssetImported: (asset: Asset) => void;
};

const statusLabel: Record<HyperFramesSource["status"], string> = {
  uploaded: "待检查",
  checking: "检查中",
  checked: "检查通过",
  failed: "检查失败",
  rendered: "已渲染导入",
};

export const HyperFramesPanel = ({projectId, fps, onAssetImported}: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<HyperFramesSource[]>([]);
  const [trusted, setTrusted] = useState(false);
  const [previewed, setPreviewed] = useState<Record<string, boolean>>({});
  const [quality, setQuality] = useState<"draft" | "standard" | "high">("standard");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try { setSources(await api.hyperFramesSources(projectId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "HyperFrames 来源读取失败"); }
  };

  useEffect(() => { void refresh(); }, [projectId]);

  const importDirectory = async (files: File[]) => {
    if (!files.length) return;
    setBusy("import"); setError(undefined);
    try { await api.importHyperFramesSource(projectId, files); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "HyperFrames 项目导入失败"); }
    finally { setBusy(undefined); }
  };

  const check = async (source: HyperFramesSource) => {
    if (!trusted) { setError("请先勾选“我确认来源可信”"); return; }
    setBusy(`check:${source.id}`); setError(undefined);
    try {
      const updated = await api.checkHyperFramesSource(projectId, source.id);
      setSources((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HyperFrames 检查失败"); await refresh(); }
    finally { setBusy(undefined); }
  };

  const render = async (source: HyperFramesSource) => {
    if (!trusted) { setError("请先确认来源可信"); return; }
    if (!previewed[source.id]) { setError("机器检查不能替代人工播放，请先确认你已预览这个 HyperFrames 画面"); return; }
    setBusy(`render:${source.id}`); setError(undefined);
    try {
      const result = await api.renderHyperFramesSource(projectId, source.id, quality);
      onAssetImported(result.asset);
      setSources((items) => items.map((item) => item.id === result.source.id ? result.source : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HyperFrames 渲染失败"); }
    finally { setBusy(undefined); }
  };

  const remove = async (source: HyperFramesSource) => {
    if (!window.confirm(`删除 HyperFrames 来源“${source.name}”？已进入素材库的视频不会被删除。`)) return;
    setBusy(`delete:${source.id}`); setError(undefined);
    try { await api.deleteHyperFramesSource(projectId, source.id); setSources((items) => items.filter((item) => item.id !== source.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "HyperFrames 来源删除失败"); }
    finally { setBusy(undefined); }
  };

  return <div className="hyperframes-panel">
    <section className="hyperframes-intro">
      <strong>HyperFrames 项目桥</strong>
      <p>导入包含 index.html 的 HyperFrames 文件夹，先检查、人工预览确认，再渲染为普通 MP4 素材。不会改写现有动效或时间线。</p>
      <button disabled={Boolean(busy)} onClick={() => inputRef.current?.click()}>{busy === "import" ? "正在导入…" : "选择 HyperFrames 文件夹"}</button>
      <input ref={inputRef} hidden multiple type="file" {...({webkitdirectory: "", directory: ""} as Record<string, string>)} onChange={(event) => { void importDirectory(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }}/>
      <label className="hyperframes-confirm"><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.currentTarget.checked)}/><span>我确认导入的是自己制作或可信的 HyperFrames 项目</span></label>
      <label className="hyperframes-quality"><span>渲染质量</span><select value={quality} onChange={(event) => setQuality(event.currentTarget.value as typeof quality)}><option value="draft">草稿</option><option value="standard">标准</option><option value="high">高质量</option></select><small>输出沿用当前项目 {fps} FPS</small></label>
      {error ? <div className="hyperframes-error">{error}</div> : null}
    </section>
    <div className="hyperframes-source-list">
      {sources.length ? sources.map((source) => <article className="hyperframes-source" key={source.id}>
        <header><div><strong>{source.name}</strong><span>{source.fileCount} 个文件</span></div><b className={`hf-status hf-${source.status}`}>{statusLabel[source.status]}</b></header>
        {source.warnings.map((warning) => <p className="hf-warning" key={warning}>{warning}</p>)}
        {source.check ? <details><summary>{source.check.summary}</summary>{source.check.output ? <pre>{source.check.output}</pre> : null}</details> : null}
        <label className="hyperframes-confirm"><input type="checkbox" checked={Boolean(previewed[source.id])} onChange={(event) => setPreviewed((value) => ({...value, [source.id]: event.currentTarget.checked}))}/><span>我已在 HyperFrames 中人工播放并确认画面</span></label>
        <div className="hf-actions">
          <button disabled={!trusted || Boolean(busy)} onClick={() => void check(source)}>{busy === `check:${source.id}` ? "检查中…" : "运行机器检查"}</button>
          <button className="primary" disabled={!trusted || !previewed[source.id] || !source.check?.passed || Boolean(busy)} onClick={() => void render(source)}>{busy === `render:${source.id}` ? "渲染中…" : "渲染并导入素材库"}</button>
          <button className="danger" disabled={Boolean(busy)} onClick={() => void remove(source)}>{busy === `delete:${source.id}` ? "删除中…" : "删除来源"}</button>
        </div>
        {source.render ? <p className="hf-imported">已生成素材：{source.render.assetId}</p> : null}
      </article>) : <div className="hf-empty">尚未导入 HyperFrames 项目</div>}
    </div>
  </div>;
};
