# HyperFrames 项目桥

## 能力边界

编导台不直接执行或改写 HyperFrames 源码。它把可信的 HyperFrames 工程放进独立来源目录，经过机器检查和人工播放确认后，调用固定版本的 HyperFrames 渲染器生成 MP4，再按编导台原有素材合同导入当前项目。

- 现有 ProjectDocument、时间线、8 个公开动效和剪辑数据不会被覆盖。
- HyperFrames 源码不进入浏览器可访问的 `public` 目录。
- 渲染结果是普通视频素材，可拖入时间线、移动、裁切、缩放、分层和删除。
- 删除 HyperFrames 来源时，不删除已经导入素材库的 MP4。
- Remotion Player 与正式导出仍使用编导台原有同源渲染链路。

## 使用步骤

1. 打开项目左侧的 `HF` 页面。
2. 选择包含 `index.html` 的完整 HyperFrames 工程目录。
3. 确认来源可信后运行机器检查。
4. 在 HyperFrames 中人工播放并确认构图、文字、节奏和动画。
5. 选择渲染质量，点击“渲染并导入素材库”。
6. 回到“素材”，把生成的 MP4 拖入画布或时间线继续编辑。

## 安全与环境

- 拒绝 `.git`、`node_modules`、`.env`、`.npmrc`、`.netrc` 和常见私钥文件。
- 检测到远程网址、网络请求或远程脚本时会警告。
- 机器检查通过不等于人工播放验收通过，两者是独立阶段门。
- 固定使用 `hyperframes@0.7.90`，需要 Node.js、`npx`、ffmpeg 和 ffprobe；首次使用可能需要联网获取依赖。

## 验证

```bash
pnpm check
```
