'use strict';

// Generated from resources/creator-skills by the maintainer bundle compiler.
// Do not edit bytes by hand; source changes require a signed bundle revision.
const bundle = {
  "catalog": {
    "manifest": {
      "schema": "t8-creator-skill-catalog-v1",
      "revision": 1,
      "skills": [
        {
          "id": "product-image-direction",
          "title": "商品主视觉",
          "version": "1.0.0",
          "kind": "image",
          "adapterId": "image-v1",
          "description": "从一张商品图出发，设计一张主体清晰、材质可信的广告创意图。",
          "presentation": {
            "titleEn": "Product hero image",
            "descriptionEn": "Turn one product reference into a focused advertising image with believable materials.",
            "inputZh": "一张商品图 + 你的用途",
            "inputEn": "One product image + intended use",
            "outputZh": "一张创意图；产品与文字需核对",
            "outputEn": "One creative image; review the product and text"
          },
          "contract": {
            "schema": "t8-creator-skill-contract-v1",
            "referenceKind": "image",
            "minReferences": 1,
            "maxReferences": 1,
            "maxOutputs": 1,
            "maxShots": 1,
            "checks": [
              "product-identity",
              "requested-text",
              "requested-scope"
            ]
          },
          "quality": {
            "status": "unverified"
          },
          "maintenance": {
            "owner": "T8-penguin-canvas",
            "license": "MIT",
            "lastValidatedAt": null
          },
          "packageDigest": "5dcf9eff2802c8208f92abddadcf8887a565fbf1d748e6ae951e1f88fca09978"
        },
        {
          "id": "product-motion-shot",
          "title": "商品动态镜头",
          "version": "1.0.0",
          "kind": "video",
          "adapterId": "video-v1",
          "description": "让一张商品图成为一段连续镜头，保持主体并安排清楚的运动起止。",
          "presentation": {
            "titleEn": "Product motion shot",
            "descriptionEn": "Make one continuous product shot with a clear camera move and consistent identity.",
            "inputZh": "一张商品图 + 想表现的动作",
            "inputEn": "One product image + desired motion",
            "outputZh": "一段连续视频；不含额外剪辑配音",
            "outputEn": "One continuous video; no separate editing or voiceover"
          },
          "contract": {
            "schema": "t8-creator-skill-contract-v1",
            "referenceKind": "image",
            "minReferences": 1,
            "maxReferences": 1,
            "maxOutputs": 1,
            "maxShots": 1,
            "checks": [
              "product-continuity",
              "motion-continuity",
              "complete-video"
            ]
          },
          "quality": {
            "status": "unverified"
          },
          "maintenance": {
            "owner": "T8-penguin-canvas",
            "license": "MIT",
            "lastValidatedAt": null
          },
          "packageDigest": "5a67049b9d4b44dcf0144776db3d30f8e19291f06a576c948e14939996790f51"
        },
        {
          "id": "product-prompt-brief",
          "title": "商品提示词整理",
          "version": "1.0.0",
          "kind": "text",
          "adapterId": "text-v1",
          "description": "把零散信息整理成完整、可修改的图片提示词，不直接生成媒体。",
          "presentation": {
            "titleEn": "Product prompt brief",
            "descriptionEn": "Shape scattered product facts into a complete editable image prompt, without generating media.",
            "inputZh": "商品事实或原有提示词；图片可选",
            "inputEn": "Product facts or an existing prompt; image optional",
            "outputZh": "完整提示词 + 最多三个核对点",
            "outputEn": "A complete prompt + up to three checks"
          },
          "quality": {
            "status": "unverified"
          },
          "maintenance": {
            "owner": "T8-penguin-canvas",
            "license": "MIT",
            "lastValidatedAt": null
          },
          "packageDigest": "c4787cb054acd404f1ccf8a82666801c6947d0377c72a5fd0f8706d5928b9b26"
        }
      ]
    },
    "keyId": "creator-bundled-20260910",
    "signature": "2h/Ejxbe64TP5LePugl75fy5wRC7Aa21wdEHIT24PuGHWloqbvn1XbbXma7i9lkA9QwXqaxWwCgOLOA4fOBjAw=="
  },
  "packages": {
    "product-image-direction": {
      "schema": "t8-creator-skill-package-v1",
      "packageDigest": "5dcf9eff2802c8208f92abddadcf8887a565fbf1d748e6ae951e1f88fca09978",
      "metadata": {
        "name": "product-image-direction",
        "description": "Turn one supplied product image and a short brief into one product-led advertising image. Use for a new product scene or composition, not exact pixel editing, typography production, or a batch campaign.",
        "license": "MIT",
        "compatibility": "",
        "declaredTools": "",
        "declaredVersion": "1.0.0"
      },
      "body": "# 商品主视觉 / Product-led image\n\n把用户的一张商品图变成一张有明确卖点、可信材质和清晰视觉层级的广告创意图。跟随用户使用的语言；英文需求用英文交付。尊重用户指定的风格、比例、受众和保留范围，不把所有产品做成同一种奢华棚拍。\n\n## 从素材到方向\n\n先区分看得见的产品事实、用户明确提供的事实和需要保留的不确定性。保留主体形状、包装比例、配色、材质、可辨认的标志及数量；不要从模糊图中猜品牌、成分、价格、功效或认证。\n\n没有商品图时，只问用户提供哪张商品图，不凭空替换商品。用户给多张图且主商品不明确时，只问哪一张作为本次主体；其他图不能悄悄变成混合产品。没有额外要求时，以单主体、适度留白、清晰材质光和一张成品为起点，比例优先跟随输入。不要重复询问已给出的信息。\n\n从用户目标选择一个视觉动作：例如以背光说明透明材质、以近景表现触感、以相关生活场景说明用途。装饰必须服务主体，不加入未经要求的促销标、认证章或道具品牌。最终完整提示词应讲清主体保留、场景关系、构图、光线、材质和明确禁止的改动，避免堆砌互相冲突的风格词。\n\n## 交付与修改\n\n用户只要方向或提示词时，交付完整文本，不安排生成。用户明确要成图时，先简短说明方案，再通过宿主已有的图片动作与生成确认完成；说明、提示词和规划都不等于图片已经生成。\n\n长提示词放入完整作品，聊天仅说明这版解决了什么。用户调整背景、光线等局部要求时，只改变相关描述；保留未要求变化的产品事实与已接受方向。宿主只支持整图生成时，明确说明不能保证逐像素局部编辑，不声称主体绝对不变。\n\n生成后用 [产品验收要点](references/product-checks.md) 对照原图。无法可靠读出的文字标为待核对，不以“高清”“商业级”替代检查。不要自动反复付费重绘或覆盖已采用作品。",
      "referencedPaths": [
        "references/product-checks.md"
      ],
      "diagnostics": [],
      "compatibility": "text-only",
      "totalBytes": 3302,
      "files": [
        {
          "path": "SKILL.md",
          "size": 2454,
          "sha256": "06e7c7718de55ee99b49a6dca29eb536a26cb5c8fb6cf86953f9bf62879162b3",
          "content": "LS0tCm5hbWU6IHByb2R1Y3QtaW1hZ2UtZGlyZWN0aW9uCmRlc2NyaXB0aW9uOiBUdXJuIG9uZSBzdXBwbGllZCBwcm9kdWN0IGltYWdlIGFuZCBhIHNob3J0IGJyaWVmIGludG8gb25lIHByb2R1Y3QtbGVkIGFkdmVydGlzaW5nIGltYWdlLiBVc2UgZm9yIGEgbmV3IHByb2R1Y3Qgc2NlbmUgb3IgY29tcG9zaXRpb24sIG5vdCBleGFjdCBwaXhlbCBlZGl0aW5nLCB0eXBvZ3JhcGh5IHByb2R1Y3Rpb24sIG9yIGEgYmF0Y2ggY2FtcGFpZ24uCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICB2ZXJzaW9uOiAiMS4wLjAiCi0tLQoKIyDllYblk4HkuLvop4bop4kgLyBQcm9kdWN0LWxlZCBpbWFnZQoK5oqK55So5oi355qE5LiA5byg5ZWG5ZOB5Zu+5Y+Y5oiQ5LiA5byg5pyJ5piO56Gu5Y2W54K544CB5Y+v5L+h5p2Q6LSo5ZKM5riF5pmw6KeG6KeJ5bGC57qn55qE5bm/5ZGK5Yib5oSP5Zu+44CC6Lef6ZqP55So5oi35L2/55So55qE6K+t6KiA77yb6Iux5paH6ZyA5rGC55So6Iux5paH5Lqk5LuY44CC5bCK6YeN55So5oi35oyH5a6a55qE6aOO5qC844CB5q+U5L6L44CB5Y+X5LyX5ZKM5L+d55WZ6IyD5Zu077yM5LiN5oqK5omA5pyJ5Lqn5ZOB5YGa5oiQ5ZCM5LiA56eN5aWi5Y2O5qOa5ouN44CCCgojIyDku47ntKDmnZDliLDmlrnlkJEKCuWFiOWMuuWIhueci+W+l+ingeeahOS6p+WTgeS6i+WunuOAgeeUqOaIt+aYjuehruaPkOS+m+eahOS6i+WunuWSjOmcgOimgeS/neeVmeeahOS4jeehruWumuaAp+OAguS/neeVmeS4u+S9k+W9oueKtuOAgeWMheijheavlOS+i+OAgemFjeiJsuOAgeadkOi0qOOAgeWPr+i+qOiupOeahOagh+W/l+WPiuaVsOmHj++8m+S4jeimgeS7juaooeeziuWbvuS4reeMnOWTgeeJjOOAgeaIkOWIhuOAgeS7t+agvOOAgeWKn+aViOaIluiupOivgeOAggoK5rKh5pyJ5ZWG5ZOB5Zu+5pe277yM5Y+q6Zeu55So5oi35o+Q5L6b5ZOq5byg5ZWG5ZOB5Zu+77yM5LiN5Yet56m65pu/5o2i5ZWG5ZOB44CC55So5oi357uZ5aSa5byg5Zu+5LiU5Li75ZWG5ZOB5LiN5piO56Gu5pe277yM5Y+q6Zeu5ZOq5LiA5byg5L2c5Li65pys5qyh5Li75L2T77yb5YW25LuW5Zu+5LiN6IO95oKE5oKE5Y+Y5oiQ5re35ZCI5Lqn5ZOB44CC5rKh5pyJ6aKd5aSW6KaB5rGC5pe277yM5Lul5Y2V5Li75L2T44CB6YCC5bqm55WZ55m944CB5riF5pmw5p2Q6LSo5YWJ5ZKM5LiA5byg5oiQ5ZOB5Li66LW354K577yM5q+U5L6L5LyY5YWI6Lef6ZqP6L6T5YWl44CC5LiN6KaB6YeN5aSN6K+i6Zeu5bey57uZ5Ye655qE5L+h5oGv44CCCgrku47nlKjmiLfnm67moIfpgInmi6nkuIDkuKrop4bop4nliqjkvZzvvJrkvovlpoLku6Xog4zlhYnor7TmmI7pgI/mmI7mnZDotKjjgIHku6Xov5Hmma/ooajnjrDop6bmhJ/jgIHku6Xnm7jlhbPnlJ/mtLvlnLrmma/or7TmmI7nlKjpgJTjgILoo4XppbDlv4XpobvmnI3liqHkuLvkvZPvvIzkuI3liqDlhaXmnKrnu4/opoHmsYLnmoTkv4PplIDmoIfjgIHorqTor4Hnq6DmiJbpgZPlhbflk4HniYzjgILmnIDnu4jlrozmlbTmj5DnpLror43lupTorrLmuIXkuLvkvZPkv53nlZnjgIHlnLrmma/lhbPns7vjgIHmnoTlm77jgIHlhYnnur/jgIHmnZDotKjlkozmmI7noa7npoHmraLnmoTmlLnliqjvvIzpgb/lhY3loIbnoIzkupLnm7jlhrLnqoHnmoTpo47moLzor43jgIIKCiMjIOS6pOS7mOS4juS/ruaUuQoK55So5oi35Y+q6KaB5pa55ZCR5oiW5o+Q56S66K+N5pe277yM5Lqk5LuY5a6M5pW05paH5pys77yM5LiN5a6J5o6S55Sf5oiQ44CC55So5oi35piO56Gu6KaB5oiQ5Zu+5pe277yM5YWI566A55+t6K+05piO5pa55qGI77yM5YaN6YCa6L+H5a6/5Li75bey5pyJ55qE5Zu+54mH5Yqo5L2c5LiO55Sf5oiQ56Gu6K6k5a6M5oiQ77yb6K+05piO44CB5o+Q56S66K+N5ZKM6KeE5YiS6YO95LiN562J5LqO5Zu+54mH5bey57uP55Sf5oiQ44CCCgrplb/mj5DnpLror43mlL7lhaXlrozmlbTkvZzlk4HvvIzogYrlpKnku4Xor7TmmI7ov5nniYjop6PlhrPkuobku4DkuYjjgILnlKjmiLfosIPmlbTog4zmma/jgIHlhYnnur/nrYnlsYDpg6jopoHmsYLml7bvvIzlj6rmlLnlj5jnm7jlhbPmj4/ov7DvvJvkv53nlZnmnKropoHmsYLlj5jljJbnmoTkuqflk4Hkuovlrp7kuI7lt7LmjqXlj5fmlrnlkJHjgILlrr/kuLvlj6rmlK/mjIHmlbTlm77nlJ/miJDml7bvvIzmmI7noa7or7TmmI7kuI3og73kv53or4HpgJDlg4/ntKDlsYDpg6jnvJbovpHvvIzkuI3lo7Dnp7DkuLvkvZPnu53lr7nkuI3lj5jjgIIKCueUn+aIkOWQjueUqCBb5Lqn5ZOB6aqM5pS26KaB54K5XShyZWZlcmVuY2VzL3Byb2R1Y3QtY2hlY2tzLm1kKSDlr7nnhafljp/lm77jgILml6Dms5Xlj6/pnaDor7vlh7rnmoTmloflrZfmoIfkuLrlvoXmoLjlr7nvvIzkuI3ku6XigJzpq5jmuIXigJ3igJzllYbkuJrnuqfigJ3mm7/ku6Pmo4Dmn6XjgILkuI3opoHoh6rliqjlj43lpI3ku5jotLnph43nu5jmiJbopobnm5blt7Lph4fnlKjkvZzlk4HjgIIK"
        },
        {
          "path": "references/product-checks.md",
          "size": 848,
          "sha256": "dbe114f2058dccfbad83be16937a886e84e11a7dc3a3cfec31501e4ae14b2005",
          "content": "IyDkuqflk4Hlm77moLjlr7kKCuS4ieS4quehrOajgOafpeeLrOeri+S6juWuoee+juWIpOaWre+8mgoKMS4g5Li75L2T6Lqr5Lu977ya6L2u5buT44CB5YWz6ZSu57uT5p6E44CB6aKc6Imy5ZKM5YyF6KOF5q+U5L6L5LiO6L6T5YWl5LiA6Ie077yM5rKh5pyJ5aSa55Sf5LiA5Liq5Lqn5ZOB5oiW6J6N5ZCI6IOM5pmv6YGT5YW344CCCjIuIOaMh+WumuaWh+Wtl++8mueUqOaIt+imgeaxguS/neeVmeeahOS4reaWh+OAgeaVsOWtl+WSjCBMT0dPIOiDveS4juWOn+WbvumAkOmhueWvueeFp++8m+S7u+S9leaUueWtl+OAgea8j+Wtl+OAgeS8qumAoOiupOivgemDveS4jeiDveiiq+aehOWbvuaIluWFieW9seWKoOWIhuaKtea2iOOAguaXoOazleehruiupOaXtuWGmeKAnOmcgOaguOWvueKAne+8jOS4jeimgeWGmeKAnOW3sumAmui/h+KAneOAggozLiDku7vliqHojIPlm7TvvJrmnKzmrKHopoHmsYLnmoTmr5TkvovjgIHkuLvkvZPmlbDph4/lkozlhYHorrjkv67mlLnojIPlm7TlvpfliLDmu6HotrPjgILlsYDpg6jkv67mlLnlpoLlrp7pmYXlgZrkuobmlbTlm77lho3nlJ/miJDvvIzopoHor7TmmI7kuLvkvZPkuZ/lj6/og73lj5HnlJ/lj5jljJbjgIIKCuWuoee+juajgOafpeWFs+azqOS4u+S9k+aYr+WQpuS4gOecvOWPr+i+qOOAgeadkOi0qOaYr+WQpuWPr+S/oeOAgeeVmeeZveaYr+WQpuacjeWKoeeUqOaIt+eUqOmAlOOAguW7uuiuruaYjuehrueahOS4gOWkhOS/ruaUue+8jOS4jee7meepuuazm+i1nue+juOAguaWh+S7tuiDveino+eggeWPquivgeaYjuaKgOacr+S6pOS7mO+8m+eUqOaIt+mHh+eUqOS5n+S4jeaYr+WvueaJgOacieacquadpeS9nOWTgeeahOi0qOmHj+S/neivgeOAggo="
        }
      ]
    },
    "product-motion-shot": {
      "schema": "t8-creator-skill-package-v1",
      "packageDigest": "5a67049b9d4b44dcf0144776db3d30f8e19291f06a576c948e14939996790f51",
      "metadata": {
        "name": "product-motion-shot",
        "description": "Plan and generate one continuous product video shot from one reference image, with a coherent camera move and product identity checks. Use for a short product motion shot, not a multi-scene advertisement, music edit, or promised voiceover.",
        "license": "MIT",
        "compatibility": "",
        "declaredTools": "",
        "declaredVersion": "1.0.0"
      },
      "body": "# 商品动态镜头 / Product motion shot\n\n把用户的一张商品参考图变成一段有起止状态、运动逻辑和视觉重点的连续镜头。使用用户的语言，不默认把一段短镜头扩成多场广告。\n\n从参考图确认主体轮廓、包装、颜色、标志位置、当前摆放和可见环境。只使用用户提供或可观察的事实；无法读清的文字不猜。缺少主体参考时先请用户选一张图。多张图之间存在矛盾时，先明确本次主体，不偷偷拼接成新商品。\n\n先决定镜头要揭示什么，再选择一种主运动，例如缓慢推近显示材质，或小幅侧移制造层次。镜头、产品和环境的运动要分开描述，避免同时要求高速环绕、变焦、旋转和多个产品变形。除非用户要求，商品保持稳定，环境只做少量可解释的变化。不编造背面设计，不透视穿过不透明包装，不把光影变化写成产品变色。\n\n把完整镜头提示词写为可执行的时间进程：起始构图与产品状态、主要运动及节奏、结束构图与停留。时长与分辨率以宿主真实模型支持为准，不在技能中自造不存在的参数。用户未指定时，用当前模型支持的短时长；不能以固定“电影级”口号替代动作说明。\n\n用户只要脚本或提示词时，仅交付完整文本。用户明确要生成视频时，使用宿主已有的视频动作和生成确认；不把提示词、静态图或任务已受理写成视频完成。此方法交付一个连续镜头，不承诺剪辑、配乐、配音或字幕。若用户需要这些，先说明本方法未覆盖的交付物。\n\n结合 [动态连续性核对](references/motion-checks.md) 检查可见结果。修改时只改用户指出的运动、时长或构图，保留主体事实和已接受风格。已有结果保留，失败重做范围由用户明确，不自动追加付费次数。",
      "referencedPaths": [
        "references/motion-checks.md"
      ],
      "diagnostics": [],
      "compatibility": "text-only",
      "totalBytes": 2980,
      "files": [
        {
          "path": "SKILL.md",
          "size": 2260,
          "sha256": "719bba4671f80c74d26de2d27ecc2cc7e9063f6cef598cea2deb547a811320e3",
          "content": "LS0tCm5hbWU6IHByb2R1Y3QtbW90aW9uLXNob3QKZGVzY3JpcHRpb246IFBsYW4gYW5kIGdlbmVyYXRlIG9uZSBjb250aW51b3VzIHByb2R1Y3QgdmlkZW8gc2hvdCBmcm9tIG9uZSByZWZlcmVuY2UgaW1hZ2UsIHdpdGggYSBjb2hlcmVudCBjYW1lcmEgbW92ZSBhbmQgcHJvZHVjdCBpZGVudGl0eSBjaGVja3MuIFVzZSBmb3IgYSBzaG9ydCBwcm9kdWN0IG1vdGlvbiBzaG90LCBub3QgYSBtdWx0aS1zY2VuZSBhZHZlcnRpc2VtZW50LCBtdXNpYyBlZGl0LCBvciBwcm9taXNlZCB2b2ljZW92ZXIuCmxpY2Vuc2U6IE1JVAptZXRhZGF0YToKICB2ZXJzaW9uOiAiMS4wLjAiCi0tLQoKIyDllYblk4HliqjmgIHplZzlpLQgLyBQcm9kdWN0IG1vdGlvbiBzaG90CgrmiornlKjmiLfnmoTkuIDlvKDllYblk4Hlj4LogIPlm77lj5jmiJDkuIDmrrXmnInotbfmraLnirbmgIHjgIHov5DliqjpgLvovpHlkozop4bop4nph43ngrnnmoTov57nu63plZzlpLTjgILkvb/nlKjnlKjmiLfnmoTor63oqIDvvIzkuI3pu5jorqTmiorkuIDmrrXnn63plZzlpLTmianmiJDlpJrlnLrlub/lkYrjgIIKCuS7juWPguiAg+WbvuehruiupOS4u+S9k+i9ruW7k+OAgeWMheijheOAgeminOiJsuOAgeagh+W/l+S9jee9ruOAgeW9k+WJjeaRhuaUvuWSjOWPr+ingeeOr+Wig+OAguWPquS9v+eUqOeUqOaIt+aPkOS+m+aIluWPr+inguWvn+eahOS6i+Wunu+8m+aXoOazleivu+a4heeahOaWh+Wtl+S4jeeMnOOAgue8uuWwkeS4u+S9k+WPguiAg+aXtuWFiOivt+eUqOaIt+mAieS4gOW8oOWbvuOAguWkmuW8oOWbvuS5i+mXtOWtmOWcqOefm+ebvuaXtu+8jOWFiOaYjuehruacrOasoeS4u+S9k++8jOS4jeWBt+WBt+aLvOaOpeaIkOaWsOWVhuWTgeOAggoK5YWI5Yaz5a6a6ZWc5aS06KaB5o+t56S65LuA5LmI77yM5YaN6YCJ5oup5LiA56eN5Li76L+Q5Yqo77yM5L6L5aaC57yT5oWi5o6o6L+R5pi+56S65p2Q6LSo77yM5oiW5bCP5bmF5L6n56e75Yi26YCg5bGC5qyh44CC6ZWc5aS044CB5Lqn5ZOB5ZKM546v5aKD55qE6L+Q5Yqo6KaB5YiG5byA5o+P6L+w77yM6YG/5YWN5ZCM5pe26KaB5rGC6auY6YCf546v57uV44CB5Y+Y54Sm44CB5peL6L2s5ZKM5aSa5Liq5Lqn5ZOB5Y+Y5b2i44CC6Zmk6Z2e55So5oi36KaB5rGC77yM5ZWG5ZOB5L+d5oyB56iz5a6a77yM546v5aKD5Y+q5YGa5bCR6YeP5Y+v6Kej6YeK55qE5Y+Y5YyW44CC5LiN57yW6YCg6IOM6Z2i6K6+6K6h77yM5LiN6YCP6KeG56m/6L+H5LiN6YCP5piO5YyF6KOF77yM5LiN5oqK5YWJ5b2x5Y+Y5YyW5YaZ5oiQ5Lqn5ZOB5Y+Y6Imy44CCCgrmiorlrozmlbTplZzlpLTmj5DnpLror43lhpnkuLrlj6/miafooYznmoTml7bpl7Tov5vnqIvvvJrotbflp4vmnoTlm77kuI7kuqflk4HnirbmgIHjgIHkuLvopoHov5Dliqjlj4roioLlpY/jgIHnu5PmnZ/mnoTlm77kuI7lgZznlZnjgILml7bplb/kuI7liIbovqjnjofku6Xlrr/kuLvnnJ/lrp7mqKHlnovmlK/mjIHkuLrlh4bvvIzkuI3lnKjmioDog73kuK3oh6rpgKDkuI3lrZjlnKjnmoTlj4LmlbDjgILnlKjmiLfmnKrmjIflrprml7bvvIznlKjlvZPliY3mqKHlnovmlK/mjIHnmoTnn63ml7bplb/vvJvkuI3og73ku6Xlm7rlrprigJznlLXlvbHnuqfigJ3lj6Plj7fmm7/ku6PliqjkvZzor7TmmI7jgIIKCueUqOaIt+WPquimgeiEmuacrOaIluaPkOekuuivjeaXtu+8jOS7heS6pOS7mOWujOaVtOaWh+acrOOAgueUqOaIt+aYjuehruimgeeUn+aIkOinhumikeaXtu+8jOS9v+eUqOWuv+S4u+W3suacieeahOinhumikeWKqOS9nOWSjOeUn+aIkOehruiupO+8m+S4jeaKiuaPkOekuuivjeOAgemdmeaAgeWbvuaIluS7u+WKoeW3suWPl+eQhuWGmeaIkOinhumikeWujOaIkOOAguatpOaWueazleS6pOS7mOS4gOS4qui/nue7remVnOWktO+8jOS4jeaJv+ivuuWJqui+keOAgemFjeS5kOOAgemFjemfs+aIluWtl+W5leOAguiLpeeUqOaIt+mcgOimgei/meS6m++8jOWFiOivtOaYjuacrOaWueazleacquimhueblueahOS6pOS7mOeJqeOAggoK57uT5ZCIIFvliqjmgIHov57nu63mgKfmoLjlr7ldKHJlZmVyZW5jZXMvbW90aW9uLWNoZWNrcy5tZCkg5qOA5p+l5Y+v6KeB57uT5p6c44CC5L+u5pS55pe25Y+q5pS555So5oi35oyH5Ye655qE6L+Q5Yqo44CB5pe26ZW/5oiW5p6E5Zu+77yM5L+d55WZ5Li75L2T5LqL5a6e5ZKM5bey5o6l5Y+X6aOO5qC844CC5bey5pyJ57uT5p6c5L+d55WZ77yM5aSx6LSl6YeN5YGa6IyD5Zu055Sx55So5oi35piO56Gu77yM5LiN6Ieq5Yqo6L+95Yqg5LuY6LS55qyh5pWw44CCCg=="
        },
        {
          "path": "references/motion-checks.md",
          "size": 720,
          "sha256": "82bdf8b262f9f995857296b7ba80f836862f1163cce997d7695fdb952ba97f7a",
          "content": "IyDov57nu63plZzlpLTmoLjlr7kKCjEuIOS6p+WTgei6q+S7vei/nue7re+8mui1t+Wni+OAgeS4reauteOAgee7k+WwvueahOS4u+S9k+aVsOmHj+OAgei9ruW7k+OAgeWMheijheWSjOagh+W/l+S9jee9ruS4gOiHtO+8jOayoeacieeqgeeEtuiejeWMluOAgeaNouWMheijheaIluWinuWHj+mDqOS7tuOAggoyLiDov5Dliqjov57nu63vvJrlrp7pmYXov5DliqjnrKblkIjlt7Lnoa7orqTnmoTmlrnlkJHjgIHoioLlpY/lkoznu5PmnZ/nirbmgIHvvIzmsqHmnInml6DmhI/ot7PliIfjgIHlj43lkJHnnqznp7vmiJbnqb/mqKHjgILkuI3opoHlj6rlh63nrKzkuIDluKfliKTmlq3mlbTmrrXpgJrov4fjgIIKMy4g5Lqk5LuY5a6M5pW077ya56Gu5a6e6I635b6X5Y+v5pKt5pS+55qE6KeG6aKR77yb5q+U5L6L5LiO5pe26ZW/56ym5ZCI56Gu6K6k6IyD5Zu044CC5pyq57uP5pSv5oyB55qE6YWN6Z+z44CB5a2X5bmV5oiW5Ymq6L6R5LiN6IO95YaZ5oiQ5bey5Lqk5LuY44CCCgrmloflrZflnKjov5Dliqjov4fnqIvkuK3ku43pnIDpgJDmrrXmoLjlr7nvvJvmuIXmmbDpppbluKfkuI3ku6PooajkuK3mrrXmsqHmnInmlLnlrZfjgILlvZPliY3lrr/kuLvml6Dms5XlhYXliIbmo4Dmn6XnmoTpobnnm67mmI7noa7moIfkuLrnlKjmiLflvoXmoLjlr7njgILmioDmnK/op6PnoIHmiJDlip/jgIHlrqHnvo7lpb3nnIvlkozku7vliqHlrozmiJDmmK/kuI3lkIznu5PorrrjgIIK"
        }
      ]
    },
    "product-prompt-brief": {
      "schema": "t8-creator-skill-package-v1",
      "packageDigest": "c4787cb054acd404f1ccf8a82666801c6947d0377c72a5fd0f8706d5928b9b26",
      "metadata": {
        "name": "product-prompt-brief",
        "description": "Turn product facts and a loose image brief into a complete, editable image prompt with clear constraints. Use when the user wants prompt writing or revision rather than image generation.",
        "license": "MIT",
        "compatibility": "",
        "declaredTools": "",
        "declaredVersion": "1.0.0"
      },
      "body": "# 商品提示词整理 / Product prompt brief\n\n把用户零散的商品信息、参考图说明和创作要求整理成可直接使用的完整提示词。纯文字资料也可以完成，不强迫用户上传图。用用户的语言写作，保持品牌语气；不擅自扩展成营销方案、多镜头广告或实际媒体生成。\n\n优先保留用户明确的信息：主体是什么、谁会看、在哪里使用、必须保留什么、允许改变什么。区分已知事实与创意设定，不补写价格、功效、认证、模糊图片上的品牌字或不存在的卖点。仅当关键信息缺失到无法写出有意义提示词时，问一个最重要的问题；其余使用说明清楚的合理默认。\n\n完整作品包含两部分：\n\n- 可复制的提示词正文：自然连贯地说明主体身份与保留项、主体和环境的关系、构图/留白、光线/材质、用户明确指定的文字及比例。信息必须自足，不写“同上”“见之前那条”。\n- 简短核对项：最多三个对这份要求真正重要的检查点；标明任何尚待用户确认的事实。不要把内部 ID、模型配置、检查记录塞进提示词正文。\n\n用户提供了原稿时，先保留有效部分，再解决冲突、歧义或多余形容词。用户要求“只改背景”“缩短但保留中文文案”等限定修改时，其他事实和指定文字原样保留。若缩短会破坏必要信息，指出取舍而不是悄悄删掉。\n\n长正文放入完整文本作品，聊天只说明改进点并提供后续修改方向。交付提示词不等于完成图片；此技能不发起图片、视频、上传或额外评审调用。用户改为想要成图时，说明可以切换到图片创作方法，保留现有提示词供用户使用，不擅自替换任务。",
      "referencedPaths": [],
      "diagnostics": [],
      "compatibility": "text-only",
      "totalBytes": 2090,
      "files": [
        {
          "path": "SKILL.md",
          "size": 2090,
          "sha256": "f3ce87fc8d1b71c0dde6fc6a07b8ee15492df901d511e16b84aa30c1aee869a3",
          "content": "LS0tCm5hbWU6IHByb2R1Y3QtcHJvbXB0LWJyaWVmCmRlc2NyaXB0aW9uOiBUdXJuIHByb2R1Y3QgZmFjdHMgYW5kIGEgbG9vc2UgaW1hZ2UgYnJpZWYgaW50byBhIGNvbXBsZXRlLCBlZGl0YWJsZSBpbWFnZSBwcm9tcHQgd2l0aCBjbGVhciBjb25zdHJhaW50cy4gVXNlIHdoZW4gdGhlIHVzZXIgd2FudHMgcHJvbXB0IHdyaXRpbmcgb3IgcmV2aXNpb24gcmF0aGVyIHRoYW4gaW1hZ2UgZ2VuZXJhdGlvbi4KbGljZW5zZTogTUlUCm1ldGFkYXRhOgogIHZlcnNpb246ICIxLjAuMCIKLS0tCgojIOWVhuWTgeaPkOekuuivjeaVtOeQhiAvIFByb2R1Y3QgcHJvbXB0IGJyaWVmCgrmiornlKjmiLfpm7bmlaPnmoTllYblk4Hkv6Hmga/jgIHlj4LogIPlm77or7TmmI7lkozliJvkvZzopoHmsYLmlbTnkIbmiJDlj6/nm7TmjqXkvb/nlKjnmoTlrozmlbTmj5DnpLror43jgILnuq/mloflrZfotYTmlpnkuZ/lj6/ku6XlrozmiJDvvIzkuI3lvLrov6vnlKjmiLfkuIrkvKDlm77jgILnlKjnlKjmiLfnmoTor63oqIDlhpnkvZzvvIzkv53mjIHlk4HniYzor63msJTvvJvkuI3mk4Xoh6rmianlsZXmiJDokKXplIDmlrnmoYjjgIHlpJrplZzlpLTlub/lkYrmiJblrp7pmYXlqpLkvZPnlJ/miJDjgIIKCuS8mOWFiOS/neeVmeeUqOaIt+aYjuehrueahOS/oeaBr++8muS4u+S9k+aYr+S7gOS5iOOAgeiwgeS8mueci+OAgeWcqOWTqumHjOS9v+eUqOOAgeW/hemhu+S/neeVmeS7gOS5iOOAgeWFgeiuuOaUueWPmOS7gOS5iOOAguWMuuWIhuW3suefpeS6i+WunuS4juWIm+aEj+iuvuWumu+8jOS4jeihpeWGmeS7t+agvOOAgeWKn+aViOOAgeiupOivgeOAgeaooeeziuWbvueJh+S4iueahOWTgeeJjOWtl+aIluS4jeWtmOWcqOeahOWNlueCueOAguS7heW9k+WFs+mUruS/oeaBr+e8uuWkseWIsOaXoOazleWGmeWHuuacieaEj+S5ieaPkOekuuivjeaXtu+8jOmXruS4gOS4quacgOmHjeimgeeahOmXrumimO+8m+WFtuS9meS9v+eUqOivtOaYjua4healmueahOWQiOeQhum7mOiupOOAggoK5a6M5pW05L2c5ZOB5YyF5ZCr5Lik6YOo5YiG77yaCgotIOWPr+WkjeWItueahOaPkOekuuivjeato+aWh++8muiHqueEtui/nui0r+WcsOivtOaYjuS4u+S9k+i6q+S7veS4juS/neeVmemhueOAgeS4u+S9k+WSjOeOr+Wig+eahOWFs+ezu+OAgeaehOWbvi/nlZnnmb3jgIHlhYnnur8v5p2Q6LSo44CB55So5oi35piO56Gu5oyH5a6a55qE5paH5a2X5Y+K5q+U5L6L44CC5L+h5oGv5b+F6aG76Ieq6Laz77yM5LiN5YaZ4oCc5ZCM5LiK4oCd4oCc6KeB5LmL5YmN6YKj5p2h4oCd44CCCi0g566A55+t5qC45a+56aG577ya5pyA5aSa5LiJ5Liq5a+56L+Z5Lu96KaB5rGC55yf5q2j6YeN6KaB55qE5qOA5p+l54K577yb5qCH5piO5Lu75L2V5bCa5b6F55So5oi356Gu6K6k55qE5LqL5a6e44CC5LiN6KaB5oqK5YaF6YOoIElE44CB5qih5Z6L6YWN572u44CB5qOA5p+l6K6w5b2V5aGe6L+b5o+Q56S66K+N5q2j5paH44CCCgrnlKjmiLfmj5Dkvpvkuobljp/nqL/ml7bvvIzlhYjkv53nlZnmnInmlYjpg6jliIbvvIzlho3op6PlhrPlhrLnqoHjgIHmrafkuYnmiJblpJrkvZnlvaLlrrnor43jgILnlKjmiLfopoHmsYLigJzlj6rmlLnog4zmma/igJ3igJznvKnnn63kvYbkv53nlZnkuK3mlofmlofmoYjigJ3nrYnpmZDlrprkv67mlLnml7bvvIzlhbbku5bkuovlrp7lkozmjIflrprmloflrZfljp/moLfkv53nlZnjgILoi6XnvKnnn63kvJrnoLTlnY/lv4XopoHkv6Hmga/vvIzmjIflh7rlj5boiI3ogIzkuI3mmK/mgoTmgoTliKDmjonjgIIKCumVv+ato+aWh+aUvuWFpeWujOaVtOaWh+acrOS9nOWTge+8jOiBiuWkqeWPquivtOaYjuaUuei/m+eCueW5tuaPkOS+m+WQjue7reS/ruaUueaWueWQkeOAguS6pOS7mOaPkOekuuivjeS4jeetieS6juWujOaIkOWbvueJh++8m+atpOaKgOiDveS4jeWPkei1t+WbvueJh+OAgeinhumikeOAgeS4iuS8oOaIlumineWkluivhOWuoeiwg+eUqOOAgueUqOaIt+aUueS4uuaDs+imgeaIkOWbvuaXtu+8jOivtOaYjuWPr+S7peWIh+aNouWIsOWbvueJh+WIm+S9nOaWueazle+8jOS/neeVmeeOsOacieaPkOekuuivjeS+m+eUqOaIt+S9v+eUqO+8jOS4jeaTheiHquabv+aNouS7u+WKoeOAggo="
        }
      ]
    }
  }
};
module.exports = { bundle };
