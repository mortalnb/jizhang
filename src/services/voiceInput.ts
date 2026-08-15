import type { AppSettings } from '../types';
import { cloudApi } from './cloudApi';
import { storage } from './storage';

export const MAX_VOICE_SECONDS = 60;
const TARGET_SAMPLE_RATE = 16_000;

export interface VoiceRecording {
  audioDataUrl: string;
  durationSeconds: number;
}

export interface ActiveVoiceRecorder {
  cancel: () => Promise<void>;
  stop: () => Promise<VoiceRecording>;
}

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

const mergeBuffers = (buffers: Float32Array[]) => {
  const merged = new Float32Array(buffers.reduce((sum, buffer) => sum + buffer.length, 0));
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }
  return merged;
};

const downsample = (input: Float32Array, inputRate: number, outputRate: number) => {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let source = start; source < end; source += 1) sum += input[source];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
};

const writeText = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
};

const encodeWav = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeText(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(view, 8, 'WAVE');
  writeText(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(buffer);
};

const bytesToDataUrl = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
};

const microphoneErrorMessage = (error: unknown) => {
  const value = error as { message?: unknown; name?: unknown };
  const name = String(value?.name ?? '');
  const message = String(value?.message ?? '');
  if (name === 'NotAllowedError' || /permission denied|notallowed/i.test(message)) {
    return '麦克风权限被拒绝。请在系统设置 → 应用 → 记账 → 权限 → 麦克风中选择“仅使用期间允许”，然后返回重试';
  }
  if (name === 'NotFoundError') return '未检测到可用麦克风';
  if (name === 'NotReadableError') return '麦克风暂时不可用，请关闭正在占用麦克风的应用后重试';
  return message || '无法访问麦克风，请检查系统权限';
};

export const startVoiceRecorder = async (): Promise<ActiveVoiceRecorder> => {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前设备不支持应用内录音');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    throw new Error(microphoneErrorMessage(error), { cause: error });
  }
  const AudioContextClass = window.AudioContext || (window as AudioWindow).webkitAudioContext;
  if (!AudioContextClass) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('当前 WebView 不支持音频采集');
  }
  const context = new AudioContextClass();
  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      stream.getTracks().forEach(track => track.stop());
      await context.close().catch(() => undefined);
      throw new Error('无法启动音频采集，请重新授权麦克风权限');
    }
  }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  const buffers: Float32Array[] = [];
  processor.onaudioprocess = event => buffers.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  const startedAt = performance.now();
  let finished = false;

  const cleanup = async () => {
    if (finished) return;
    finished = true;
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    silent.disconnect();
    stream.getTracks().forEach(track => track.stop());
    await context.close();
  };

  return {
    async cancel() {
      await cleanup();
    },
    async stop() {
      const durationSeconds = Math.min(MAX_VOICE_SECONDS, (performance.now() - startedAt) / 1000);
      const inputRate = context.sampleRate;
      await cleanup();
      if (durationSeconds < 0.4 || buffers.length === 0) throw new Error('录音太短，请至少说一句完整内容');
      const samples = downsample(mergeBuffers(buffers), inputRate, TARGET_SAMPLE_RATE);
      const audioDataUrl = bytesToDataUrl(encodeWav(samples, TARGET_SAMPLE_RATE));
      if (audioDataUrl.length > 10_000_000) throw new Error('录音超过 MiMo 10 MB 限制，请缩短后重试');
      return { audioDataUrl, durationSeconds: Number(durationSeconds.toFixed(1)) };
    },
  };
};

const modelText = (payload: unknown) => {
  const value = payload as {
    choices?: Array<{ message?: { audio?: { transcript?: unknown }; content?: unknown; reasoning_content?: unknown } }>;
    text?: unknown;
  };
  const message = value.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const joined = content
      .map(item => (item && typeof item === 'object' && 'text' in item ? String((item as { text?: unknown }).text ?? '') : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }
  return String(message?.audio?.transcript ?? message?.reasoning_content ?? value.text ?? '').trim();
};

export const transcribeVoice = async (recording: VoiceRecording, settings: AppSettings) => {
  if (settings.aiMode === 'cloud') {
    if (!storage.getCloudSession()?.accessToken) throw new Error('云端模式未登录，请先登录云端服务');
    return cloudApi.transcribeAudio(settings, recording.audioDataUrl, recording.durationSeconds);
  }
  const useDevProxy = import.meta.env.DEV;
  if (!settings.apiKey.trim() && !useDevProxy) throw new Error('真正的语音转写需要 MiMo API Key，或登录云端服务');
  const response = await fetch(useDevProxy ? '/__dev_mimo_chat' : `${settings.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(useDevProxy ? {} : { Authorization: `Bearer ${settings.apiKey}` }),
    },
    body: JSON.stringify({
      model: 'mimo-v2.5-asr',
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: recording.audioDataUrl } }] }],
      asr_options: { language: 'zh' },
    }),
  });
  if (!response.ok) throw new Error(`MiMo ASR HTTP ${response.status}`);
  const transcript = modelText(await response.json());
  if (!transcript) throw new Error('MiMo ASR 未返回可用文字');
  return transcript;
};
