You are given the original video path and an empty V2 agent work directory. Analyze the video yourself and return the final shot-boundary JSON.

manifest:
{{manifestJson}}

output contract:
{{outputContractJson}}

Process requirements:
- Use `shell_command` to inspect the original video and generate only the evidence you need.
- Keep all generated files under `manifest.video.evidenceOutputDir`.
- When you generate a contact sheet, candidate sheet, or other image you need to inspect, make the command print `LOCAL_IMAGE: <absolute image path>` on its own line. The runtime will attach that image back to you.
- You may generate overview sheets, scene-score logs, dense sheets, candidate sheets, or any other scratch evidence as needed.
- Do not read existing project shot analyses, old V1/V2 results, reviewer output, cache, or history.
- Candidate checks must use `t-3f / t-1f / t / t+1f / t+3f`.
- Accept only hard cuts, obvious jump cuts, transitions, or abrupt subject/scene/composition changes. Reject continuous camera/hand/product/subtitle/exposure motion.

Return only the JSON object matching the contract. Do not output markdown, explanatory prose, local paths, frame ids, or references to old project shots.
