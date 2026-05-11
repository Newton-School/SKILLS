# svg-to-lottie

A Claude skill for converting SVGs into Lottie JSON animations from a plain-English brief.

## Example

```
[paste SVG]
> Make this pop in with a bounce, then loop with sound waves emanating outward
```

Claude generates a valid `.json` file playable in [lottiefiles.com/preview](https://lottiefiles.com/preview), LottieFiles, lottie-web, or any standard player.

## Install

Drop the folder into your Claude user skills directory:

```
~/skills/svg-to-lottie/
```

## Layout

```
SKILL.md                          workflow + cardinal rules
scripts/svg_to_lottie_paths.py    SVG → Lottie cubic-bezier converter
scripts/build_template.py         starter builder, copy-and-adapt per task
references/patterns.md            keyframe recipes (bounce, waves, glow, morph)
references/lottie-gotchas.md      bugs that bite, with fixes
```

## Built with

- [`svgpathtools`](https://github.com/mathandy/svgpathtools) for SVG path parsing

## Author

[Sahil Ranpuri](https://www.linkedin.com/in/sahilranpuri/) — Product designer at Newton School.
