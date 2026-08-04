import assert from "node:assert/strict";
import {access, mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, dirname, resolve} from "node:path";
import test from "node:test";

const workspace = resolve(dirname(new URL(import.meta.url).pathname), "..");
const fixtureRoot = resolve(workspace, "tests/fixtures/hyperframes-basic");

const multerFile = async (absolutePath, relativePath) => {
  const buffer = await readFile(absolutePath);
  return {fieldname: "files", originalname: basename(absolutePath), encoding: "7bit", mimetype: absolutePath.endsWith(".json") ? "application/json" : "text/html", size: buffer.byteLength, destination: "", filename: basename(absolutePath), path: absolutePath, buffer, relativePath};
};

test("HyperFrames 来源可隔离检查、渲染并作为普通素材导入", {timeout: 180_000}, async (context) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "a9-hyperframes-bridge-"));
  context.after(async () => rm(temporaryRoot, {recursive: true, force: true}));
  const publicRoot = resolve(temporaryRoot, "public");
  const projectId = "hf-integration";
  const projectDirectory = resolve(publicRoot, "projects", projectId);
  await mkdir(projectDirectory, {recursive: true});
  const project = {
    schemaVersion: "project-document/1",
    projectId,
    name: "HyperFrames 隔离集成测试",
    status: "candidate_not_approved",
    settings: {width: 320, height: 180, fps: 30, durationInFrames: 30, orientation: "horizontal"},
    assets: [],
    tracks: [
      {id: "track-aroll", type: "video", name: "口播原片", order: 10, enabled: true, locked: false},
      {id: "track-overlays", type: "overlay", name: "动效与素材", order: 30, enabled: true, locked: false},
      {id: "track-captions", type: "caption", name: "中文字幕", order: 40, enabled: true, locked: false},
    ],
    clips: [{
      id: "caption-test",
      type: "caption",
      trackId: "track-captions",
      from: 0,
      durationInFrames: 30,
      sourceInFrames: 0,
      props: {text: "HyperFrames test"},
      transform: {x: 20, y: 140, width: 280, height: 24, scale: 1, rotation: 0, opacity: 1, zIndex: 40},
      enabled: true,
      origin: {kind: "manual"},
    }],
    styleProfileRef: {id: "ajiunotes-tech-console-v1", version: "0.1.0"},
    templateRegistryVersion: "0.1.0",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
  await writeFile(resolve(projectDirectory, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  process.env.VISUAL_WORKBENCH_PUBLIC_ROOT = publicRoot;
  const bridge = await import(`../local-service/dist/hyperframes-bridge.js?test=${Date.now()}`);
  const relativePaths = ["index.html", "hyperframes.json", "meta.json"];
  const files = await Promise.all(relativePaths.map((path) => multerFile(resolve(fixtureRoot, path), path)));
  const source = await bridge.importHyperFramesSource(projectId, files, relativePaths, "测试动效");
  assert.equal(source.status, "uploaded");
  assert.equal(source.fileCount, 3);
  assert.ok(!source.sourceDirectory.startsWith(publicRoot), "HyperFrames 源码不能放进浏览器可访问的 public 目录");
  await assert.rejects(bridge.checkHyperFramesSource(projectId, source.id, ""), /确认这是你信任的 HyperFrames 项目/);
  const checked = await bridge.checkHyperFramesSource(projectId, source.id, "我确认来源可信");
  assert.equal(checked.status, "checked");
  assert.equal(checked.check?.passed, true);
  const rendered = await bridge.renderHyperFramesSource(projectId, source.id, "我确认来源可信", "draft");
  assert.equal(rendered.source.status, "rendered");
  assert.equal(rendered.asset.type, "video");
  assert.equal(rendered.asset.mimeType, "video/mp4");
  assert.equal(rendered.asset.sourceKind, "owned");
  assert.ok((rendered.asset.durationInFrames ?? 0) > 0);
  const importedPath = resolve(publicRoot, rendered.asset.sourcePath);
  assert.ok((await stat(importedPath)).size > 1024);
  await bridge.deleteHyperFramesSource(projectId, source.id);
  await assert.rejects(access(source.sourceDirectory));
  await access(importedPath);
});
