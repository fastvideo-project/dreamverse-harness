# Fish Audio Drama 3 prompts for task t2a

Model `fish-audio-drama-3` for task `t2a` speaks the prompt as one clip. The prompt is the text to speak, with the markup below.

## Markup

- **Speaker tags.** A tag `<|speaker:N|>` marks who speaks the text after it. Use only the speaker numbers that `dv_models_get` lists under `speakers`; a prompt with any other speaker tag is refused before it runs. Text without a leading tag is spoken as speaker 0. When `speakers` holds only 0, a clip has one speaker, so write one clip per character.
- **Sound events.** Write a bracketed event, such as `[sighs]` or `[laughs]`, at the point in the text where the event should land.
- **Languages.** The model card lists 83 languages, among them Chinese, English, Japanese and Korean.
- **Length.** One clip holds at most about 95 seconds of speech. Split longer text at sentence ends into several clips.

## Voices

The model picks the voice of each clip, so one character can sound different in two clips. When one character speaks in several clips, tell the user that the clips may not share one voice.

## Example

    <|speaker:0|> Welcome to DreamVerse, traveler. [laughs] It has been a very long road. [sighs] Rest here tonight.

## Sources

- [Fish Audio Drama 3 model card](https://huggingface.co/fishaudio/Drama-3), the speaker-tag list and the section "Point tags"
- [SGLang-Omni Drama 3 cookbook](https://sgl-project.github.io/sglang-omni/cookbook/fishaudio_drama3.html), the section "Prompt Length"
