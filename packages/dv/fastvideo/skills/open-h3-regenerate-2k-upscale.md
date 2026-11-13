# Open-H3-Regenerate-2K: upscale a draft take to 2K

Use task `v2v` of model `open-h3-regenerate-2k` (provider `fastvideo`) to regenerate an existing MiniMax H3 take, such as
a FastH3 480p or 768p render, at 2560x1440. It keeps the draft's scene, framing, motion and timing and adds detail; it
does not change the content.

- Pass the draft as the one `reference` input: the take's version, such as `s3@2`. Use no first or last frame.
- Use the draft's own prompt, unchanged. Do not add style or detail instructions; the 2K model is conditioned on the
  same description the draft was made from. Do not cite the reference in the prompt.
- Duration and frame count follow the draft (5 seconds, 124 frames at 24 fps); the output is always 2560x1440.
- A 2K regeneration takes minutes, longer than the draft. Upscale the takes the user keeps, not every take.
