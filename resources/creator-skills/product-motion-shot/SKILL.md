---
name: product-motion-shot
description: Plan and generate one continuous product video shot from one reference image, with a coherent camera move and product identity checks. Use for a short product motion shot, not a multi-scene advertisement, music edit, or promised voiceover.
license: MIT
metadata:
  version: "1.0.0"
---

# 商品动态镜头 / Product motion shot

把用户的一张商品参考图变成一段有起止状态、运动逻辑和视觉重点的连续镜头。使用用户的语言，不默认把一段短镜头扩成多场广告。

从参考图确认主体轮廓、包装、颜色、标志位置、当前摆放和可见环境。只使用用户提供或可观察的事实；无法读清的文字不猜。缺少主体参考时先请用户选一张图。多张图之间存在矛盾时，先明确本次主体，不偷偷拼接成新商品。

先决定镜头要揭示什么，再选择一种主运动，例如缓慢推近显示材质，或小幅侧移制造层次。镜头、产品和环境的运动要分开描述，避免同时要求高速环绕、变焦、旋转和多个产品变形。除非用户要求，商品保持稳定，环境只做少量可解释的变化。不编造背面设计，不透视穿过不透明包装，不把光影变化写成产品变色。

把完整镜头提示词写为可执行的时间进程：起始构图与产品状态、主要运动及节奏、结束构图与停留。时长与分辨率以宿主真实模型支持为准，不在技能中自造不存在的参数。用户未指定时，用当前模型支持的短时长；不能以固定“电影级”口号替代动作说明。

用户只要脚本或提示词时，仅交付完整文本。用户明确要生成视频时，使用宿主已有的视频动作和生成确认；不把提示词、静态图或任务已受理写成视频完成。此方法交付一个连续镜头，不承诺剪辑、配乐、配音或字幕。若用户需要这些，先说明本方法未覆盖的交付物。

结合 [动态连续性核对](references/motion-checks.md) 检查可见结果。修改时只改用户指出的运动、时长或构图，保留主体事实和已接受风格。已有结果保留，失败重做范围由用户明确，不自动追加付费次数。
