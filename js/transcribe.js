// 使用 @spotify/basic-pitch（TensorFlow.js）將音訊轉成音符。

const MODEL_URL = new URL('../vendor/basic-pitch-model/model.json', import.meta.url).href;
export const BASIC_PITCH_SAMPLE_RATE = 22050;

let libPromise = null;
let modelInstance = null;

async function loadLib() {
  if (!libPromise) {
    libPromise = import('../vendor/basic-pitch.js').then(async (lib) => {
      try {
        await lib.tf.setBackend('webgl');
      } catch {
        /* 無 WebGL 時退回 CPU */
      }
      await lib.tf.ready();
      if (lib.tf.getBackend() !== 'webgl') await lib.tf.setBackend('cpu');
      return lib;
    });
    libPromise.catch(() => {
      libPromise = null;
    });
  }
  return libPromise;
}

// 靈敏度預設：onset 門檻、frame 門檻、最短音長（frame 數）
const PRESETS = {
  low: { onset: 0.6, frame: 0.4, minLen: 11 },
  medium: { onset: 0.5, frame: 0.3, minLen: 8 },
  high: { onset: 0.3, frame: 0.25, minLen: 5 },
};

/**
 * @param {Float32Array} signal 22050 Hz 單聲道
 * @param {'low'|'medium'|'high'} sensitivity
 * @param {(p:number)=>void} onProgress
 */
export async function transcribe(signal, sensitivity = 'medium', onProgress = () => {}) {
  const lib = await loadLib();
  if (!modelInstance) modelInstance = new lib.BasicPitch(MODEL_URL);
  const frames = [];
  const onsets = [];
  const contours = [];
  await modelInstance.evaluateModel(
    signal,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress(p),
  );
  const p = PRESETS[sensitivity] || PRESETS.medium;
  // 吉他音域約 E2(82Hz) ~ 1400Hz
  const notes = lib.noteFramesToTime(
    lib.addPitchBendsToNoteEvents(
      contours,
      lib.outputToNotesPoly(frames, onsets, p.onset, p.frame, p.minLen, true, 1400, 70),
    ),
  );
  return notes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}
