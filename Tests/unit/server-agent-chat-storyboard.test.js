const {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createServer,
  makeRequest,
  makeRawRequest,
  closeServer,
} = require("./server-test.helpers");

test("agent chat storyboard result projects generated images and upstream aspect", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-chat-storyboard-result-"));
  try {
    const artifactDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "demo-video");
    const framesDir = path.join(artifactDir, "shot-storyboard-frames");
    await fsPromises.mkdir(framesDir, { recursive: true });
    const shotDesignPath = path.join(artifactDir, "shot-design.final.md");
    await fsPromises.writeFile(shotDesignPath, "# shot design\n", "utf8");
    await fsPromises.writeFile(path.join(artifactDir, "restructure.display.json"), JSON.stringify({
      sections: {
        finalSlotChain: {
          items: [
            {
              type: "table",
              rows: [
                {
                  "顺序": "1",
                  slotSubtype: "`SUB_hook` 熟悉经验钩子槽",
                },
              ],
            },
          ],
        },
      },
    }), "utf8");
    await fsPromises.writeFile(path.join(artifactDir, "shot-storyboard-manifest.json"), JSON.stringify({
      aspect: { ratio: "16:9", orientation: "横屏" },
      cover: {
        coverId: "cover_image",
        aspect: { ratio: "16:9", orientation: "横屏" },
        overlayPackaging: "封面标题",
      },
      shots: [
        {
          shotId: "new_shot_01",
          slotKey: "SUB_hook",
          slotSubtype: "`SUB_hook` 熟悉经验钩子槽",
          shouldGenerate: false,
          strategy: "existing_material_packaging_caption",
          strategyRaw: "`existing_material_packaging_caption`：使用 `shot_1`",
          sourceRefs: ["shot_1"],
          scriptSegment: "第 5 节：熟悉需求入口",
          rhythmRange: "第 6 节：入口快节奏",
          packagingBlock: "第 7 节：标题和字幕",
          imagePrompt: "原素材 `shot_1`：杯中豆浆勺取",
          overlayPackaging: "上方标题，底部字幕，关键词高亮",
          dialogue: "后期字幕/旁白：“素材镜头。”",
          duration: "0.8-1.0s",
          syncPoint: "动作、标题和字幕同步",
          proofFunction: "用现有素材建立需求入口",
        },
        {
          shotId: "new_shot_02",
          slotKey: "SUB_hook -> SUB_claim",
          shouldGenerate: true,
          dialogue: "旁白/主字幕：“生成镜头。”",
          duration: "1.0-1.2s",
        },
      ],
    }), "utf8");
    await fsPromises.writeFile(path.join(framesDir, "cover_image.png"), Buffer.from("cover"));
    await fsPromises.writeFile(path.join(framesDir, "material.jpg"), Buffer.from("material"));
    await fsPromises.writeFile(path.join(framesDir, "new_shot_02.png"), Buffer.from("png"));
    await fsPromises.writeFile(path.join(artifactDir, "shot-storyboard-pdf-input.json"), JSON.stringify({
      cover: {
        coverId: "cover_image",
        imagePath: "Artifacts/FunctionSlotRestructure/demo-video/shot-storyboard-frames/cover_image.png",
        width: 1600,
        height: 900,
      },
      shots: [
        {
          shotId: "new_shot_01",
          mediaKind: "material-frame",
          imagePath: "Artifacts/FunctionSlotRestructure/demo-video/shot-storyboard-frames/material.jpg",
          width: 1600,
          height: 900,
        },
      ],
    }), "utf8");
    await fsPromises.writeFile(path.join(framesDir, "shot-storyboard-crops.json"), JSON.stringify({
      source: {
        artifactId: "artifact_image",
        traceId: "trace_image",
        parentArtifactId: "artifact_parent",
      },
      crops: [
        {
          shotId: "cover_image",
          isCover: true,
          cropBox: [0, 0, 1600, 900],
          path: path.join(framesDir, "cover_image.png"),
        },
        {
          shotId: "new_shot_02",
          cropBox: [0, 0, 1600, 900],
          path: path.join(framesDir, "new_shot_02.png"),
        },
      ],
    }), "utf8");
    const artifactDirSecond = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "demo-video-second");
    const framesDirSecond = path.join(artifactDirSecond, "shot-storyboard-frames");
    await fsPromises.mkdir(framesDirSecond, { recursive: true });
    const shotDesignPathSecond = path.join(artifactDirSecond, "shot-design.final.md");
    await fsPromises.writeFile(shotDesignPathSecond, "# shot design second\n", "utf8");
    await fsPromises.writeFile(path.join(artifactDirSecond, "shot-storyboard-manifest.json"), JSON.stringify({
      aspect: { ratio: "9:16", orientation: "竖屏" },
      shots: [
        {
          shotId: "new_shot_second",
          slotKey: "SUB_second",
          shouldGenerate: true,
          dialogue: "旁白：“第二版。”",
          duration: "2.0s",
        },
      ],
    }), "utf8");
    await fsPromises.writeFile(path.join(framesDirSecond, "new_shot_second.png"), Buffer.from("second"));
    await fsPromises.writeFile(path.join(framesDirSecond, "shot-storyboard-crops.json"), JSON.stringify({
      source: {
        artifactId: "artifact_second_image",
        traceId: "trace_second_image",
      },
      crops: [
        {
          shotId: "new_shot_second",
          cropBox: [0, 0, 900, 1600],
          path: path.join(framesDirSecond, "new_shot_second.png"),
        },
      ],
    }), "utf8");
    const multiDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "demo-video-multi");
    for (const [versionId, shotId, bytes] of [["V1_click", "shot_v1", "v1"], ["V2_conversion", "shot_v2", "v2"]]) {
      const versionDir = path.join(multiDir, "versions", versionId);
      const versionFramesDir = path.join(versionDir, "shot-storyboard-frames");
      await fsPromises.mkdir(versionFramesDir, { recursive: true });
      await fsPromises.writeFile(path.join(versionDir, "shot-design.final.md"), "# shot design\n", "utf8");
      await fsPromises.writeFile(path.join(versionDir, "shot-storyboard-manifest.json"), JSON.stringify({
        aspect: { ratio: "9:16", orientation: "竖屏" },
        shots: [{
          shotId,
          slotKey: `SUB_${versionId}`,
          shouldGenerate: true,
          dialogue: `旁白：“${versionId}。”`,
          duration: "1.0s",
        }],
      }), "utf8");
      await fsPromises.writeFile(path.join(versionFramesDir, `${shotId}.png`), Buffer.from(bytes));
      await fsPromises.writeFile(path.join(versionFramesDir, "shot-storyboard-crops.json"), JSON.stringify({
        source: { artifactId: `artifact_${versionId}`, traceId: `trace_${versionId}` },
        crops: [{ shotId, cropBox: [0, 0, 900, 1600], path: path.join(versionFramesDir, `${shotId}.png`) }],
      }), "utf8");
    }

    const conversation = {
      conversationId: "conversation_storyboard",
      title: "故事板会话",
      status: "active",
      revision: 1,
      threadId: "thread_storyboard",
      confirmedPlan: {
        status: "completed",
        sourceShotDesignPath: path.relative(rootDir, shotDesignPath).replaceAll(path.sep, "/"),
        storyboardArtifact: { artifactId: "artifact_old", status: "processing" },
      },
      messages: [
        {
          id: "storyboard-result-second",
          role: "system",
          text: "方案完成",
          status: "completed",
          storyboardResult: {
            status: "completed",
            turnId: "turn_second",
            confirmationId: "confirm_second",
            sourceShotDesignPath: path.relative(rootDir, shotDesignPathSecond).replaceAll(path.sep, "/"),
            storyboardArtifact: { artifactId: "artifact_second", status: "processed" },
          },
        },
        {
          id: "storyboard-result-multi",
          role: "system",
          text: "多版本方案完成",
          status: "completed",
          storyboardResult: {
            mode: "multi_version",
            status: "storyboard_processing",
            turnId: "turn_multi",
            confirmationId: "confirm_multi",
            defaultVersionId: "V2_conversion",
            versions: [
              {
                versionId: "V1_click",
                versionName: "高点击版",
                status: "storyboard_processing",
                sourceShotDesignPath: path.relative(rootDir, path.join(multiDir, "versions", "V1_click", "shot-design.final.md")).replaceAll(path.sep, "/"),
                storyboardArtifact: { artifactId: "artifact_v1", status: "processing" },
              },
              {
                versionId: "V2_conversion",
                versionName: "高转化版",
                status: "storyboard_processing",
                sourceShotDesignPath: path.relative(rootDir, path.join(multiDir, "versions", "V2_conversion", "shot-design.final.md")).replaceAll(path.sep, "/"),
                storyboardArtifact: { artifactId: "artifact_v2", status: "processing" },
              },
            ],
          },
        },
      ],
    };
    const server = createServer({
      rootDir,
      agentConversationStore: {
        get: async (conversationId) => conversationId === conversation.conversationId ? conversation : null,
        list: async () => [conversation],
      },
      staticWorkbench: { handle: () => false },
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    server.unref();
    try {
      const response = await makeRequest(server, "GET", "/api/agent-chat/conversations/conversation_storyboard/storyboard-result");
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.status, "available");
      assert.equal(response.body.aspect.ratio, "16:9");
      assert.equal(response.body.cover.imageUrl, "/api/agent-chat/conversations/conversation_storyboard/storyboard-result/images/cover_image");
      assert.equal(response.body.cover.aspect.ratio, "16:9");
      assert.equal(response.body.groups.length, 1);
      assert.equal(response.body.groups[0].label, "01");
      assert.equal(response.body.groups[0].title, "熟悉经验钩子槽");
      assert.equal(response.body.groups[0].shotCount, 2);
      assert.equal(response.body.groups[0].shots[0].imageUrl, "/api/agent-chat/conversations/conversation_storyboard/storyboard-result/images/new_shot_01");
      assert.equal(response.body.groups[0].shots[0].aspect.ratio, "16:9");
      assert.equal(response.body.groups[0].shots[0].duration, "0-0.9s");
      assert.equal(response.body.groups[0].shots[0].durationRaw, "0.8-1.0s");
      assert.match(response.body.groups[0].shots[0].durationTooltip, /预计时间轴/);
      assert.equal(response.body.groups[0].shots[0].slotSubtype, "`SUB_hook` 熟悉经验钩子槽");
      assert.equal(response.body.groups[0].shots[0].strategyRaw, "`existing_material_packaging_caption`：使用 `shot_1`");
      assert.equal(response.body.groups[0].shots[0].scriptSegment, "第 5 节：熟悉需求入口");
      assert.equal(response.body.groups[0].shots[0].rhythmRange, "第 6 节：入口快节奏");
      assert.equal(response.body.groups[0].shots[0].packagingBlock, "第 7 节：标题和字幕");
      assert.equal(response.body.groups[0].shots[0].visualPrompt, "原素材 `shot_1`：杯中豆浆勺取");
      assert.equal(response.body.groups[0].shots[0].overlayPackaging, "上方标题，底部字幕，关键词高亮");
      assert.equal(response.body.groups[0].shots[0].syncPoint, "动作、标题和字幕同步");
      assert.equal(response.body.groups[0].shots[0].proofFunction, "用现有素材建立需求入口");
      assert.equal(response.body.groups[0].shots[1].aspect.ratio, "16:9");
      assert.equal(response.body.groups[0].shots[1].duration, "0.9-2.0s");
      assert.match(response.body.groups[0].shots[1].imageUrl, /^\/api\/agent-chat\/conversations\/conversation_storyboard\/storyboard-result\/images\/new_shot_02$/);
      assert.equal(JSON.stringify(response.body).includes(rootDir), false);

      const image = await makeRawRequest(server, "GET", response.body.groups[0].shots[1].imageUrl);
      assert.equal(image.statusCode, 200);
      assert.equal(image.headers["content-type"], "image/png");
      assert.equal(image.body.toString("utf8"), "png");

      const materialImage = await makeRawRequest(server, "GET", response.body.groups[0].shots[0].imageUrl);
      assert.equal(materialImage.statusCode, 200);
      assert.equal(materialImage.headers["content-type"], "image/jpeg");
      assert.equal(materialImage.body.toString("utf8"), "material");

      const coverImage = await makeRawRequest(server, "GET", response.body.cover.imageUrl);
      assert.equal(coverImage.statusCode, 200);
      assert.equal(coverImage.headers["content-type"], "image/png");
      assert.equal(coverImage.body.toString("utf8"), "cover");

      const second = await makeRequest(server, "GET", "/api/agent-chat/conversations/conversation_storyboard/storyboard-result?resultId=storyboard-result-second");
      assert.equal(second.statusCode, 200);
      assert.equal(second.body.aspect.ratio, "9:16");
      assert.equal(second.body.groups[0].shots[0].id, "new_shot_second");
      assert.match(second.body.groups[0].shots[0].imageUrl, /resultId=storyboard-result-second$/);
      const secondImage = await makeRawRequest(server, "GET", second.body.groups[0].shots[0].imageUrl);
      assert.equal(secondImage.statusCode, 200);
      assert.equal(secondImage.headers["content-type"], "image/png");
      assert.equal(secondImage.body.toString("utf8"), "second");

      const multiDefault = await makeRequest(server, "GET", "/api/agent-chat/conversations/conversation_storyboard/storyboard-result?resultId=storyboard-result-multi");
      assert.equal(multiDefault.statusCode, 200);
      assert.equal(multiDefault.body.mode, "multi_version");
      assert.equal(multiDefault.body.defaultVersionId, "V2_conversion");
      assert.equal(multiDefault.body.selectedVersionId, "V2_conversion");
      assert.equal(multiDefault.body.versions.length, 2);
      assert.equal(multiDefault.body.groups[0].shots[0].id, "shot_v2");
      assert.match(multiDefault.body.groups[0].shots[0].imageUrl, /versionId=V2_conversion/);

      const multiV1 = await makeRequest(server, "GET", "/api/agent-chat/conversations/conversation_storyboard/storyboard-result?resultId=storyboard-result-multi&versionId=V1_click");
      assert.equal(multiV1.statusCode, 200);
      assert.equal(multiV1.body.selectedVersionId, "V1_click");
      assert.equal(multiV1.body.groups[0].shots[0].id, "shot_v1");
      const multiImage = await makeRawRequest(server, "GET", multiV1.body.groups[0].shots[0].imageUrl);
      assert.equal(multiImage.statusCode, 200);
      assert.equal(multiImage.body.toString("utf8"), "v1");
    } finally {
      await closeServer(server);
    }
  } finally {
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  }
});
