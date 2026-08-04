import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Probe a video file using ffprobe.
 *
 * Returns { durationSeconds, width, height, fps, hasAudio }.
 * The `ffprobePath` option lets tests or environments override the binary.
 */
export async function probeVideo(videoPath, { ffprobePath = 'ffprobe' } = {}) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ]));
  } catch (error) {
    throw new Error(`Failed to probe video "${videoPath}": ${error.message}`);
  }

  const data = JSON.parse(stdout);

  let width = 0;
  let height = 0;
  let fps = 0;
  let hasAudio = false;

  if (data.streams) {
    for (const stream of data.streams) {
      if (stream.codec_type === 'video' && !width) {
        width = stream.width || 0;
        height = stream.height || 0;
        const frameRate = stream.avg_frame_rate || stream.r_frame_rate;
        if (typeof frameRate === 'string') {
          const [numerator, denominator = '1'] = frameRate.split('/').map(Number);
          if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
            fps = numerator / denominator;
          }
        }
      }
      if (stream.codec_type === 'audio') {
        hasAudio = true;
      }
    }
  }

  const durationSeconds = data.format?.duration
    ? parseFloat(data.format.duration)
    : 0;

  return { durationSeconds, width, height, fps, hasAudio };
}

/**
 * Extract raw RGB bytes for a single frame.
 *
 * @param {string} videoPath
 * @param {'first'|'last'} which
 * @returns {Promise<Buffer>} raw RGB24 bytes
 */
export async function extractFrame(videoPath, which, { ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe' } = {}) {
  const args = [];

  if (which === 'last') {
    const probe = await probeVideo(videoPath, { ffprobePath });
    const seekTo = Math.max(0, probe.durationSeconds - 0.1);
    args.push('-ss', seekTo.toString());
  }

  args.push(
    '-i', videoPath,
    '-vframes', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  );

  let stdout;
  try {
    ({ stdout } = await execFileAsync(ffmpegPath, args, {
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024,
    }));
  } catch (error) {
    throw new Error(`Failed to extract ${which} frame from "${videoPath}": ${error.message}`);
  }

  return stdout;
}
