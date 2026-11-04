# 🎸 Guitar Song Sheet

**Live:** https://jassychang.github.io/guitar-chord/

A mobile-first, fully static web app (GitHub Pages, no backend). Upload or record a song and get a **song sheet**: tempo, bar lines, chord names, 6-line guitar tab and lyrics, all lined up. Everything runs in your browser, so your audio never leaves the device.

## Features

- **Tempo panel**: BPM and beat positions from Essentia.js `RhythmExtractor2013`, with its confidence score. The time signature can be changed (2/4, 3/4, 4/4, 6/8), **Tap tempo** corrects the BPM by hand, and a **metronome** clicks at the current BPM with an accented beat 1.
- **Chords**: Essentia.js HPCP → `ChordsDetection`, snapped to the beat grid so short flickers are removed. Chord diagrams for every chord used, plus a tappable chord timeline.
- **Tab**: `@spotify/basic-pitch` (TensorFlow.js) turns the audio into notes, which are fingered for standard tuning (EADGBE). Low positions, open strings, small stretches and few hand shifts are preferred.
- **Lyrics**: Whisper (`Xenova/whisper-tiny` or `whisper-base`) via Transformers.js, with word-level timestamps, running in a Web Worker.
  - **Paste lyrics**: real lyrics are matched to Whisper's word timings. Without Whisper, or when too few words match, the lines are spread evenly across the song.
  - Every lyric line can be **edited inline**; the sheet updates as you type.
- **Song sheet**: the beats are split into measures with `|` bar lines, 4 bars per row by default. Each block shows:
  ```
  [0:09]
       C              G
  e|--0-------0---|---3-----|
  B|--1-------1---|---0-----|
  ...
       country can do for you
  ```
  - The block that's playing is highlighted, and the page can follow playback.
  - The **Chords + lyrics only** view hides the tab.
  - ◀ ▶ shift the bar lines if beat 1 was guessed wrong. You can also change bars per row and the grid (1/8 or 1/16).
  - **Copy as text** copies the current view as plain text.
- **Progress for every step**: decode, tempo, chords, notes, lyrics and sheet each have their own status and progress bar, plus an overall bar.
- **YouTube reference player** for listening along. Browsers can't read a YouTube video's audio, so upload or record to analyse.
- Mobile-first dark UI, with a sticky bottom player that shows the current chord.

## How to use

1. Open https://jassychang.github.io/guitar-chord/ (on a phone, if you like).
2. *(Optional)* Paste a YouTube link to listen along.
3. **Audio**: upload an mp3 / m4a / wav, or tap **Record** to use the microphone.
4. **Lyrics** *(optional)*: choose a Whisper model and language, and/or paste the lyrics, one line per lyric line. Pasting gives much better results for sung vocals.
5. Tap **Analyse** and watch each step's progress. The first run downloads Basic Pitch (~1 MB) and the Whisper model (~40 MB for tiny); both are cached afterwards.
6. Read the song sheet:
   - If the BPM is off, **Tap tempo** along with the song, or type the BPM.
   - If the bar lines start in the wrong place, nudge them with ◀ ▶.
   - Fix lyric lines in the **Lyrics** list.
   - Use **Copy as text** to paste the sheet anywhere.

### Tips

- A clean recording of one guitar works best. On full mixes the chords are usually useful, but the tab picks up vocals, bass and drums too; set sensitivity to **Low** to cut down the noise.
- Whisper has a hard time with singing over loud music and may return nothing or repeated phrases (which are filtered out). Pasting the lyrics is the reliable route.
- The tempo confidence follows Essentia's scale (0–5.32): above 3.5 is excellent, 1.5–3.5 is good, below 1.5 is low.
- To keep phones from running out of memory, analysis is limited to 10 minutes of audio.
- The microphone needs HTTPS, which GitHub Pages provides.

## Deploying to GitHub Pages

There's no build step: the `main` branch root *is* the site.
**Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.** Every push to `main` redeploys it.

## Local development

ES modules and workers need an HTTP server (opening `index.html` directly won't work):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

```
index.html               page
css/style.css            dark, mobile-first styles
js/app.js                UI and analysis flow
js/audio.js              decoding, resampling, recording
js/rhythm.js             tempo / beats (Essentia RhythmExtractor2013)
js/chords.js             chord detection + chord diagrams (Essentia)
js/essentia-worker.js    runs tempo + chords off the main thread
js/essentia-client.js    worker client with main-thread fallback
js/transcribe.js         Basic Pitch note transcription
js/tab.js                notes -> playable fingerings
js/lyrics.js             Whisper worker client
js/whisper-worker.js     Transformers.js Whisper, word timestamps
js/lyrics-align.js       pasted-lyrics alignment, line building, loop filter
js/sheet.js              beat grid, measures, aligned song-sheet layout
js/metronome.js          Web Audio metronome
js/youtube.js            YouTube URL parsing
vendor/                  bundled Essentia.js, Basic Pitch + model (committed, no build)
tools/build-vendor.sh    regenerates vendor/
```

Transformers.js (`@huggingface/transformers@4.3.1`) loads from jsDelivr and the Whisper models load from the Hugging Face Hub, so lyrics need a network connection the first time.

### Updating the vendored libraries

```sh
npm install
npm run build:vendor
```

## Licences and credits

- [Essentia.js](https://github.com/MTG/essentia.js): AGPL-3.0, see `vendor/essentia/LICENSE`. Because of this, the source code has to stay public when the app is deployed (this repo is public).
- [Basic Pitch](https://github.com/spotify/basic-pitch-ts) and [TensorFlow.js](https://github.com/tensorflow/tfjs): Apache-2.0.
- [Transformers.js](https://github.com/huggingface/transformers.js): Apache-2.0. [Whisper](https://github.com/openai/whisper) models: MIT.

Automatic transcription is a starting point, not gospel.
