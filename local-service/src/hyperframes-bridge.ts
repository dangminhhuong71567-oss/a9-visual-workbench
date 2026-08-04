import {execFile} from "node:child_process";
import {randomBytes} from "node:crypto";
import {access, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {basename, dirname, extname, resolve, sep} from "node:path";
import {promisify} from "node:util";
import type {Asset} from "@ajiunotes/contracts";
import {importOwnedGeneratedFile, publicRoot, readProject} from "./project-store.js";

const execFileAsync = promisify(execFile);
const hyperFramesVersion = "0.7.90";
const hyperFramesRoot = resolve(publicRoot, "..", "hyperframes-sources");
const manifestName = "source.json";
const textExtensions = new Set([".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md"]);
const blockedSegments = new Set([".git", "node_modules"]);
const blockedNames = new Set([".env", ".npmrc", ".netrc", "id_rsa", "id_ed25519"]);

export type HyperFramesSource = {
  id: string;
  projectId: string;
  name: string;
  sourceDirectory: string;
  entryDirectory: string;
  fileCount: number;
  status: "uploaded" | "checking" | "checked" | "failed" | "rendered";
  warnings: string[];
  createdAt: string;
  updatedAt: string;
  check?: {passed: boolean; checkedAt: string; summary: string; output: string};
  render?: {renderedAt: string; assetId: string; outputName: string};
};

const safeId = (value: string, label: string): string => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(value)) throw new Error(`${label}格式无效`);
  return value;
};
const inside = (root: string, candidate: string): boolean => candidate === root || candidate.startsWith(`${root}${sep}`);
const projectRoot = (projectId: string): string => resolve(hyperFramesRoot, safeId(projectId, "项目 ID"));
const sourceRoot = (projectId: string, sourceId: string): string => resolve(projectRoot(projectId), safeId(sourceId, "HyperFrames 来源 ID"));
const manifestPath = (projectId: string, sourceId: string): string => resolve(sourceRoot(projectId, sourceId), manifestName);

const readManifest = async (projectId: string, sourceId: string): Promise<HyperFramesSource> => {
  const value = JSON.parse(await readFile(manifestPath(projectId, sourceId), "utf8")) as HyperFramesSource;
  if (value.projectId !== projectId || value.id !== sourceId) throw new Error("HyperFrames 来源记录不匹配");
  return value;
};
const writeManifest = async (value: HyperFramesSource): Promise<void> => {
  const path = manifestPath(value.projectId, value.id);
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const cleanPath = (value: string): string => {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
  const segments = path.split("/").filter(Boolean);
  if (!segments.length || segments.some((part) => part === ".." || part.includes("\0"))) throw new Error("HyperFrames 文件路径无效");
  if (segments.some((part) => blockedSegments.has(part))) throw new Error("HyperFrames 来源不能包含 .git 或 node_modules");
  if (segments.some((part) => blockedNames.has(part) || part.startsWith(".env."))) throw new Error("检测到凭证或环境配置文件，请移除后重试");
  return segments.join("/");
};
const stripCommonRoot = (paths: string[]): string[] => {
  const parts = paths.map((path) => cleanPath(path).split("/"));
  const first = parts[0]?.[0];
  const strip = Boolean(first && parts.every((item) => item.length > 1 && item[0] === first));
  return parts.map((item) => (strip ? item.slice(1) : item).join("/"));
};
const warningsFor = (files: Express.Multer.File[]): string[] => {
  const warnings = new Set<string>();
  for (const file of files) {
    if (!textExtensions.has(extname(file.originalname).toLowerCase()) || file.buffer.byteLength > 2 * 1024 * 1024) continue;
    const text = file.buffer.toString("utf8");
    if (/https?:\/\//i.test(text)) warnings.add("源码包含远程网址；仅在信任来源时继续。");
    if (/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(text)) warnings.add("源码包含网络请求能力；检查或渲染时可能访问网络。");
    if (/<script[^>]+src=["']https?:\/\//i.test(text)) warnings.add("HTML 引用了远程脚本；请确认来源可信。");
  }
  return [...warnings];
};
const findEntry = async (root: string): Promise<string> => {
  try { await access(resolve(root, "index.html")); return root; } catch { /* search below */ }
  const queue: Array<{path: string; depth: number}> = [{path: root, depth: 0}];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth >= 8) continue;
    for (const entry of await readdir(current.path, {withFileTypes: true})) {
      if (!entry.isDirectory() || blockedSegments.has(entry.name)) continue;
      const next = resolve(current.path, entry.name);
      try { await access(resolve(next, "index.html")); return next; } catch { queue.push({path: next, depth: current.depth + 1}); }
    }
  }
  throw new Error("HyperFrames 来源中没有找到 index.html");
};
const npxCandidates = (): string[] => [process.env.HYPERFRAMES_NPX, "npx", "/opt/homebrew/bin/npx", "/usr/local/bin/npx"]
  .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
const runHyperFrames = async (args: string[], cwd: string, timeout: number): Promise<{stdout: string; stderr: string}> => {
  let lastError: unknown;
  for (const command of npxCandidates()) {
    try {
      const result = await execFileAsync(command, ["--yes", `hyperframes@${hyperFramesVersion}`, ...args], {
        cwd, timeout, maxBuffer: 32 * 1024 * 1024, env: {...process.env, NO_COLOR: "1"},
      });
      return {stdout: result.stdout, stderr: result.stderr};
    } catch (error) {
      lastError = error;
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") break;
    }
  }
  const detail = lastError instanceof Error && "stderr" in lastError && typeof lastError.stderr === "string"
    ? lastError.stderr.trim() : lastError instanceof Error ? lastError.message : String(lastError ?? "未知错误");
  throw new Error(`HyperFrames 命令执行失败：${detail.slice(0, 1600)}`);
};

export const listHyperFramesSources = async (projectId: string): Promise<HyperFramesSource[]> => {
  const root = projectRoot(projectId);
  await mkdir(root, {recursive: true});
  const sources: HyperFramesSource[] = [];
  for (const entry of await readdir(root, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    try { sources.push(await readManifest(projectId, entry.name)); } catch { /* ignore incomplete imports */ }
  }
  return sources.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const importHyperFramesSource = async (projectId: string, files: Express.Multer.File[], rawPaths: string[], requestedName?: string): Promise<HyperFramesSource> => {
  await readProject(projectId);
  if (!files.length || files.length !== rawPaths.length) throw new Error("HyperFrames 文件清单不完整");
  if (files.length > 3000) throw new Error("HyperFrames 来源文件过多，最多支持 3000 个文件");
  const paths = stripCommonRoot(rawPaths);
  const id = `hf-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const root = sourceRoot(projectId, id);
  const filesRoot = resolve(root, "files");
  await mkdir(filesRoot, {recursive: true});
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const relative = paths[index];
      if (!file || !relative) throw new Error("HyperFrames 文件清单不完整");
      const destination = resolve(filesRoot, relative);
      if (!inside(filesRoot, destination)) throw new Error("HyperFrames 文件路径越界");
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, file.buffer);
    }
    const entryDirectory = await findEntry(filesRoot);
    const now = new Date().toISOString();
    const name = String(requestedName || basename(entryDirectory) || "HyperFrames 来源").replace(/\s+/g, " ").trim().slice(0, 80);
    const source: HyperFramesSource = {id, projectId, name: name || "HyperFrames 来源", sourceDirectory: filesRoot, entryDirectory, fileCount: files.length, status: "uploaded", warnings: warningsFor(files), createdAt: now, updatedAt: now};
    await writeManifest(source);
    return source;
  } catch (error) {
    await rm(root, {recursive: true, force: true});
    throw error;
  }
};

const confirmTrusted = (value: unknown): void => {
  if (value !== "我确认来源可信") throw new Error("请先确认这是你信任的 HyperFrames 项目");
};
export const checkHyperFramesSource = async (projectId: string, sourceId: string, confirmation: unknown): Promise<HyperFramesSource> => {
  confirmTrusted(confirmation);
  const source = await readManifest(projectId, sourceId);
  const checking: HyperFramesSource = {...source, status: "checking", updatedAt: new Date().toISOString()};
  await writeManifest(checking);
  try {
    const result = await runHyperFrames(["check", source.entryDirectory, "--json"], source.entryDirectory, 5 * 60_000);
    const checked: HyperFramesSource = {...checking, status: "checked", check: {passed: true, checkedAt: new Date().toISOString(), summary: "机器检查通过；仍需人工播放确认画面。", output: `${result.stdout}\n${result.stderr}`.trim().slice(-12000)}, updatedAt: new Date().toISOString()};
    await writeManifest(checked);
    return checked;
  } catch (error) {
    const failed: HyperFramesSource = {...checking, status: "failed", check: {passed: false, checkedAt: new Date().toISOString(), summary: error instanceof Error ? error.message : String(error), output: ""}, updatedAt: new Date().toISOString()};
    await writeManifest(failed);
    throw error;
  }
};
export const renderHyperFramesSource = async (projectId: string, sourceId: string, confirmation: unknown, quality: unknown): Promise<{source: HyperFramesSource; asset: Asset}> => {
  confirmTrusted(confirmation);
  const source = await readManifest(projectId, sourceId);
  if (!source.check?.passed || source.status === "failed") throw new Error("请先通过 HyperFrames 机器检查");
  const project = await readProject(projectId);
  const normalizedQuality = quality === "draft" || quality === "high" ? quality : "standard";
  const outputDirectory = resolve(sourceRoot(projectId, sourceId), "renders");
  await mkdir(outputDirectory, {recursive: true});
  const outputName = `${source.id}-${Date.now().toString(36)}.mp4`;
  const outputPath = resolve(outputDirectory, outputName);
  await runHyperFrames(["render", source.entryDirectory, "--output", outputPath, "--fps", String(project.settings.fps), "--quality", normalizedQuality, "--format", "mp4"], source.entryDirectory, 20 * 60_000);
  const info = await stat(outputPath);
  if (!info.isFile() || info.size < 1024) throw new Error("HyperFrames 没有生成有效视频");
  const asset = await importOwnedGeneratedFile(projectId, outputPath, `${source.name}-HyperFrames.mp4`);
  const rendered: HyperFramesSource = {...source, status: "rendered", render: {renderedAt: new Date().toISOString(), assetId: asset.id, outputName}, updatedAt: new Date().toISOString()};
  await writeManifest(rendered);
  return {source: rendered, asset};
};
export const deleteHyperFramesSource = async (projectId: string, sourceId: string): Promise<{sourceId: string; deleted: true}> => {
  const root = sourceRoot(projectId, sourceId);
  await access(manifestPath(projectId, sourceId));
  if (!inside(projectRoot(projectId), root)) throw new Error("HyperFrames 来源路径越界");
  await rm(root, {recursive: true, force: false});
  return {sourceId, deleted: true};
};

export const hyperFramesRuntime = {version: hyperFramesVersion, npxCandidates: npxCandidates()};
