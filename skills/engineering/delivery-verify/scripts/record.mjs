// Capture the current Ego Page; no browser launch, model, or upload.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const overlayPath = new URL('../assets/recording-cursor.js', import.meta.url);

/** Own a fresh capture directory and the screencast/event queue of one managed Page.
 * Caller must await stop() in finally before closing the Page or exiting Node.
 */
export async function startRecording(page, { directory, maxDurationMs = 60000, ffmpeg = 'ffmpeg' } = {}) {
  if (!isAbsolute(directory ?? '')) throw new Error('Recording directory must be absolute');
  if (!Number.isFinite(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 300000)
    throw new Error('maxDurationMs must be between 100 and 300000');
  if (await page.evaluate('Boolean(window.__deliveryRecordingCleanup)'))
    throw new Error('This Page already has a recording owner');
  await exec(ffmpeg, ['-version']);
  await mkdir(directory); // Deliberately refuses to overwrite an earlier run.
  await mkdir(join(directory, 'frames'));
  const manifest = {
    schema_version: 1, source: 'Ego Page CDP screencast', status: 'recording',
    started_at: new Date().toISOString(), frames: [], actions: [],
    limitations: ['Viewport frames only; excludes browser chrome and audio.',
      '30 fps output repeats frames; source frame times are preserved, not a guarantee of 30 fps capture.',
      'A Chromium recording does not establish physical iPhone Safari performance.'],
  };
  let running = false, streamStarted = false, scriptId, loop, timer, stopPromise, captureError;
  const save = () => writeFile(join(directory, 'capture.json'), JSON.stringify(manifest, null, 2) + '\n');
  async function drain() {
    for (const event of await page.events()) {
      if (event.method !== 'Page.screencastFrame') continue;
      const { data, metadata, sessionId } = event.params;
      try {
        const timestamp = metadata?.timestamp;
        if (!Number.isFinite(timestamp)) throw new Error('Browser frame has no timestamp');
        const previous = manifest.frames.at(-1);
        if (previous && timestamp < previous.timestamp) throw new Error('Browser frame clock moved backwards');
        if (previous && timestamp === previous.timestamp) continue;
        const file = `frames/${String(manifest.frames.length).padStart(6, '0')}.jpg`;
        const bytes = Buffer.from(data, 'base64');
        if (!bytes.length) throw new Error('Empty browser frame');
        await writeFile(join(directory, file), bytes, { flag: 'wx' });
        manifest.frames.push({ file, timestamp });
      } finally {
        await page.cdp('Page.screencastFrameAck', { sessionId });
      }
    }
  }
  async function finish(reason) {
    clearTimeout(timer);
    running = false;
    await loop;
    const endedAt = Date.now() / 1000;
    const errors = captureError ? [captureError] : [];
    if (streamStarted) {
      try { await drain(); } catch (error) { errors.push(error); }
      try { await page.cdp('Page.stopScreencast'); streamStarted = false; }
      catch (error) { errors.push(error); }
    }
    if (scriptId) {
      try { await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }); }
      catch (error) { errors.push(error); }
    }
    if (scriptId) {
      try { await page.evaluate('window.__deliveryRecordingCleanup?.()'); }
      catch (error) { errors.push(error); }
    }
    manifest.ended_at = new Date(endedAt * 1000).toISOString();
    manifest.stop_reason = reason;
    manifest.cleanup_confirmed = !streamStarted && errors.length === 0;
    if (reason === 'max-duration') errors.push(new Error('Recording reached its maximum duration before caller completed'));
    if (!manifest.frames.length) errors.push(new Error('No browser frames were captured'));
    try {
      if (errors.length) throw new AggregateError(errors, errors.map(e => e.message).join('; '));
      const frames = manifest.frames;
      const duration = Math.max(endedAt - frames[0].timestamp,
        frames.at(-1).timestamp - frames[0].timestamp + 1 / 30);
      let concat = 'ffconcat version 1.0\n';
      const gaps = [];
      for (let i = 0; i < frames.length; i++) {
        const seconds = i + 1 < frames.length
          ? frames[i + 1].timestamp - frames[i].timestamp
          : duration - (frames[i].timestamp - frames[0].timestamp);
        gaps.push(seconds);
        concat += `file '${frames[i].file}'\nduration ${seconds.toFixed(6)}\n`;
      }
      concat += `file '${frames.at(-1).file}'\n`;
      await writeFile(join(directory, 'frames.ffconcat'), concat);
      manifest.duration_seconds = duration;
      manifest.captured_frames = frames.length;
      manifest.source_average_fps = frames.length / duration;
      manifest.max_frame_gap_seconds = Math.max(...gaps);
      manifest.output_fps = 30;
      const video = join(directory, 'recording.mp4');
      await exec(ffmpeg, ['-v','error','-n','-f','concat','-safe','1','-i',join(directory,'frames.ffconcat'),
        '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30','-t',duration.toFixed(6),
        '-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',video],
        { timeout: 60000, maxBuffer: 1024 * 1024 });
      manifest.status = 'complete';
      manifest.video = 'recording.mp4';
      await save();
      return { status: 'complete', video, manifest: join(directory,'capture.json') };
    } catch (error) {
      manifest.status = 'failed';
      manifest.error = error.message;
      await save();
      throw error;
    }
  }
  const stop = (reason = 'caller') => (stopPromise ??= finish(reason));
  try {
    const overlay = await readFile(overlayPath, 'utf8');
    scriptId = (await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: overlay })).identifier;
    await page.evaluate(overlay);
    await page.cdp('Page.startScreencast', {format:'jpeg',quality:90,everyNthFrame:1});
    streamStarted = running = true;
    await save();
    loop = (async () => {
      try { while (running) { await drain(); await sleep(25); } }
      catch (error) { captureError = error; running = false; }
    })();
    timer = setTimeout(() => { stop('max-duration').catch(() => {}); }, maxDurationMs);
  } catch (error) {
    captureError = error;
    await stop('startup-failed').catch(() => {});
    throw error;
  }
  return {
    directory,
    async caption(text) {
      if (!running) throw new Error('Recording is no longer active');
      if (typeof text !== 'string' || text.length > 300) throw new Error('Caption must be a short string');
      await page.evaluate(text => window.__deliveryRecordingCaption(text), text);
      manifest.actions.push({ timestamp: Date.now() / 1000, caption: text });
    },
    stop: () => stop(),
  };
}
