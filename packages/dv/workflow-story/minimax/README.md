# Optional MiniMax H3 Skills

English | [中文](README.zh.md)

This integration uses the existing DreamVerse Web chat, Agent, skill registry and media backends. It adds no UI or generation backend. The official [MiniMax H3 Skills](https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills) are copied unchanged under `skills/`, including Chinese instructions, references and metadata. [SOURCE.json](SOURCE.json) pins the upstream revision; [compatibility.md](compatibility.md) contains the separate DreamVerse tool mappings.

## Startup

Web users choose a Skill button under Start from a template on Home, or use the Video type menu in the Create project dialog, without environment variables. The default disables MiniMax Skills. Selecting a type saves one skill with the project; its first message loads it. Reloads and new chats retain the choice, shown in the workspace header; use a new project to switch skills. A project choice overrides the environment settings below, including explicit off even when startup mode is manual/auto. These startup settings supply defaults only for older/API-created projects without a saved choice.

Run from the repository root:

```bash
# Automatic selection, using the existing Web interface.
DV_MINIMAX_SKILLS_MODE=auto scripts/video-harness/launch.sh web

# Force one exact skill name.
DV_MINIMAX_SKILLS_MODE=manual DV_MINIMAX_SKILL=3d-animation-short-generator scripts/video-harness/launch.sh web

# Original behavior, also the default when the flag is unset.
DV_MINIMAX_SKILLS_MODE=off scripts/video-harness/launch.sh web
```

Stop the existing process before restarting on the same port. The default local URL is `http://localhost:8092`; existing `DV_PORT` and host settings still apply. These variables can also be set in `DV_ENV_FILE`; values explicitly supplied to the launch command take precedence over that file. `DV_MINIMAX_SKILLS_MODE` defaults to `off`. `manual` requires an exact official `DV_MINIMAX_SKILL`; a missing or unknown name fails activation. `auto` and `off` ignore `DV_MINIMAX_SKILL`. Invalid mode values fail validation. The old `DV_MINIMAX_SKILLS_ENABLED` variable is not used.

## Selection

Automatic routing uses ordered, case-insensitive Chinese/English rules based on the official descriptions and categories. Exact skill names in the request take precedence over keywords; manual startup selection overrides both. Only the selected official skill is advertised and loaded for that Agent. Other DreamVerse skills and tools remain available. An unmatched initial or explicit new request follows the original workflow. Confirmations, brief answers, revisions and supplied assets continue the selected workflow; cancellation or an explicit topic change clears it. These are conservative keyword rules, not semantic classification: use manual mode or an exact skill name for ambiguous requests. Reopened sessions continue when their selection remains in context; after compaction removes it, name the skill again.

| Exact name | Example automatic trigger |
| --- | --- |
| `h3-prompt-writing` | Write an H3 video prompt |
| `handdrawn-live-video-generator` | Make a hand-drawn live-action video |
| `minimalist-product-ad-generator` | Make an Apple-style product ad |
| `brand-promo-video-generator` | Create a brand promo video |
| `3d-animation-short-generator` | Create a 3D animated short |
| `music-video-subtitle-generator` | Make a music video with lyrics subtitles |
| `papercraft-stop-motion-explainer` | Create a papercraft stop-motion explainer |
| `paper-collage-explainer-generator` | Make a paper collage explainer |
| `co-op-game-intro-generator` | Create a co-op game intro |

The server logs `MiniMax skill: <name>; mode=...; revision=...; session=...`, per-skill capability availability, successful reference reads, and operation results with session/call IDs. Operation labels cover planning artifacts, approvals, image/video/audio requests and timeline assembly. They describe observed tools, not inferred semantic step completion: a successful generation submission does not mean its background job succeeded. Full calls, returned errors and job status remain in the existing session log. Prompts, credentials and raw tool arguments are not copied into these summary logs.

The injected original instructions, source revision and capability preflight are recorded as a `dv-minimax-skill` context message. Enabled projects register an Agent-scoped `dv_minimax_read_reference` before the first model request; off projects do not advertise it. It reads only that Agent's selected skill documents. No additional logging service or workflow engine is installed.

## Manual Comparison

With the feature enabled, create a new Project in the existing Web interface. For example, ask: `帮我做一个15秒的手绘发光动画与实拍融合视频，场景是厨房水槽。` Follow the skill's confirmation steps, supply reference media when requested, and generate through the configured backend. Then stop Harness, disable the feature, restart, and create another Project with the same prompt, input assets and model settings. Compare the two outputs manually. Turning the flag off does not erase instructions already stored in old conversations, so use a new Project and conversation for the baseline.

## Compatibility Limits

Selection does not imply full MiniMax Hub compatibility. The existing model catalog determines available tasks, sizes, durations and models; the default UniServe `fasth3/ref2v` route needs reference media. Image/audio services must already be configured and reachable. The Agent must preserve confirmation gates using existing questions or chat replies.

Existing tools cover image/video generation, canvas text and media, clip trimming and timeline assembly. The per-skill preflight checks scoped tool registration; it does not call paid services or certify endpoint health. The Agent must additionally check model capabilities before generation. There is no mapping for Hub canvas grouping, standalone music generation, beat analysis, soundtrack replacement, transcription, subtitle rendering or general media analysis. Timeline export's re-encoding fallback drops audio. For example, the 3D short requires matched BGM and a final audio composite, so this integration alone cannot complete that full deliverable. A skill that requires unavailable capabilities must disclose the gap before paid work and stop or agree on limited/pre-production outputs, without claiming a finished workflow. No automatic video generation or quality comparison is performed by this integration.
