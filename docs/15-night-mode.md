# 15 — Night theme

**Night** (Settings → Theme, or the reader's *Aa* panel) is for reading before sleep: dim amber on black, with
no blue light at all.

## How it works

The theme itself is in greys on pure black (black OLED pixels are off). `NightFilter`
(`frontend/src/theme/NightFilter.tsx`) then puts an SVG `feColorMatrix` filter on `<html>` that turns every
pixel amber by its brightness:

```
L  = 0.2126 R + 0.7152 G + 0.0722 B
R' = d · L      G' = 0.38 · d · L      B' = 0
```

So the blue channel is zero everywhere: covers, PDF pages (shown inverted, light text on black), images inside
EPUBs, highlights, dialogs. `d` is the **Night brightness** slider (0.25–1), which goes below the phone's lowest
brightness. Colours differ only by how light they are, so the theme's accent is a darker grey than the text
(filled buttons stay dim). The browser bar / Android status bar takes the theme's background colour.

**The tap flash:** Android paints its tap highlight (the flash on the page-turn zones, links, …) outside CSS
filters, so the filter can't make it amber. Each theme sets the flash colour itself (`tap` in
`readingThemes.ts`, as `-webkit-tap-highlight-color` on the app and inside EPUB pages). Night's is amber with no
blue; the other themes flash in their text colour instead of the system blue.

## Why these settings

- The eye's melanopsin cells, which drive melatonin and the body clock, respond most to blue light around
  480 nm; long (red) wavelengths affect them far less, though not zero
  ([Hanifin et al., high-intensity red light](https://experts.arizona.edu/en/publications/high-intensity-red-light-suppresses-melatonin/)).
- How much light reaches melanopsin matters more than the colour you see: with melanopsin excitation matched,
  yellow and blue light had no clear different effect on melatonin or sleep
  ([Blume et al., Nature Human Behaviour 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10963261/)). So
  dimness counts as much as having no blue, hence the slider.
- Pure red text tires the eyes the most and yellow the least
  ([Sensors 2024](https://doaj.org/article/bc9aaefb26464f3783451b1db92f765d)), so the theme is amber (red plus
  a little green), not pure red.
- In the dark, light text on a dark background reads better than the reverse, provided the text is dim too.
