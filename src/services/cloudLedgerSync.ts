import { checksum } from './backup';
import { CloudApiError, cloudApi } from './cloudApi';
import { storage } from './storage';
import type { AppSettings, CloudLedgerSnapshot, CloudSyncState } from '../types';

let timer: number | undefined;
let started = false;
let suppressNextChange = false;
let pushInFlight: Promise<CloudLedgerSnapshot> | undefined;
let pendingPush: { overwriteRemote?: boolean } | undefined;

const setState = (patch: Partial<CloudSyncState>) => {
  const current = storage.getCloudSyncState();
  storage.saveCloudSyncState({ ...current, ...patch, revision: patch.revision ?? current.revision });
};

const readySettings = () => {
  const settings = storage.getSettings();
  if (!settings.cloudSyncEnabled) throw new Error('云同步尚未开启');
  if (!storage.getCloudSession()?.accessToken) throw new Error('请先登录云端服务');
  return settings;
};

const markFailure = (error: unknown) => {
  if (error instanceof CloudApiError && error.status === 409) {
    setState({ status: 'conflict', error: '云端已有不同版本，已暂停自动覆盖，请选择保留本机或恢复云端。' });
    return;
  }
  setState({ status: 'error', error: error instanceof Error ? error.message : '云同步失败' });
};

const performPush = async (options: { overwriteRemote?: boolean } = {}) => {
  const settings = readySettings();
  setState({ status: 'syncing', error: undefined });
  try {
    let expectedRevision = storage.getCloudSyncState().revision;
    if (options.overwriteRemote) {
      const remote = await cloudApi.getLedgerSnapshot(settings);
      expectedRevision = remote.snapshot?.revision ?? 0;
    }
    const payload = storage.getLedgerPayload();
    const response = await cloudApi.putLedgerSnapshot(settings, {
      checksum: checksum(payload),
      expectedRevision,
      payload,
    });
    setState({
      status: 'idle',
      error: undefined,
      revision: response.snapshot.revision,
      lastSyncedAt: response.snapshot.updatedAt,
    });
    return response.snapshot;
  } catch (error) {
    markFailure(error);
    throw error;
  }
};

const push = (options: { overwriteRemote?: boolean } = {}) => {
  if (pushInFlight) {
    pendingPush = {
      overwriteRemote: Boolean(pendingPush?.overwriteRemote || options.overwriteRemote),
    };
    return pushInFlight;
  }
  pushInFlight = (async () => {
    let snapshot = await performPush(options);
    while (pendingPush) {
      const next = pendingPush;
      pendingPush = undefined;
      snapshot = await performPush(next);
    }
    return snapshot;
  })().finally(() => {
    pendingPush = undefined;
    pushInFlight = undefined;
  });
  return pushInFlight;
};

const queuePush = () => {
  if (suppressNextChange) {
    suppressNextChange = false;
    return;
  }
  window.clearTimeout(timer);
  let settings: AppSettings;
  try {
    settings = storage.getSettings();
  } catch {
    return;
  }
  if (!settings.cloudSyncEnabled || !storage.getCloudSession()?.accessToken || storage.getCloudSyncState().status === 'conflict') return;
  timer = window.setTimeout(() => void push().catch(() => undefined), 900);
};

export const cloudLedgerSync = {
  start() {
    if (started || typeof window === 'undefined') return () => undefined;
    started = true;
    window.addEventListener('ab-ledger-changed', queuePush);
    queuePush();
    return () => {
      window.removeEventListener('ab-ledger-changed', queuePush);
      window.clearTimeout(timer);
      started = false;
    };
  },

  async enable() {
    window.clearTimeout(timer);
    const settings = readySettings();
    setState({ status: 'syncing', error: undefined });
    try {
      const local = storage.getLedgerPayload();
      const remote = await cloudApi.getLedgerSnapshot(settings);
      if (!remote.snapshot) {
        setState({ revision: 0 });
        return await push();
      }
      if (remote.snapshot.checksum === checksum(local)) {
        setState({ status: 'idle', error: undefined, revision: remote.snapshot.revision, lastSyncedAt: remote.snapshot.updatedAt });
        return remote.snapshot;
      }
      setState({
        status: 'conflict',
        error: `云端已有第 ${remote.snapshot.revision} 版账本，请明确选择保留本机或恢复云端。`,
        revision: remote.snapshot.revision,
      });
      return remote.snapshot;
    } catch (error) {
      markFailure(error);
      throw error;
    }
  },

  disable() {
    window.clearTimeout(timer);
    pendingPush = undefined;
    storage.saveCloudSyncState({ revision: storage.getCloudSyncState().revision, status: 'disabled' });
  },

  pushNow(overwriteRemote = false) {
    return push({ overwriteRemote });
  },

  async restoreFromCloud() {
    const settings = readySettings();
    setState({ status: 'syncing', error: undefined });
    try {
      const remote = await cloudApi.getLedgerSnapshot(settings);
      if (!remote.snapshot) throw new Error('云端还没有账本快照');
      if (checksum(remote.snapshot.payload) !== remote.snapshot.checksum) throw new Error('云端账本校验失败，已停止恢复');
      suppressNextChange = true;
      storage.restoreCloudPayload(remote.snapshot.payload);
      setState({
        status: 'idle',
        error: undefined,
        revision: remote.snapshot.revision,
        lastSyncedAt: remote.snapshot.updatedAt,
      });
      return remote.snapshot;
    } catch (error) {
      suppressNextChange = false;
      markFailure(error);
      throw error;
    }
  },

  async mergeFromCloud() {
    const settings = readySettings();
    setState({ status: 'syncing', error: undefined });
    try {
      const remote = await cloudApi.getLedgerSnapshot(settings);
      if (!remote.snapshot) return await push({ overwriteRemote: true });
      if (checksum(remote.snapshot.payload) !== remote.snapshot.checksum) throw new Error('云端账本校验失败，已停止合并');
      suppressNextChange = true;
      storage.mergeCloudPayload(remote.snapshot.payload);
      setState({ status: 'idle', error: undefined, revision: remote.snapshot.revision, lastSyncedAt: remote.snapshot.updatedAt });
      return await push();
    } catch (error) {
      suppressNextChange = false;
      markFailure(error);
      throw error;
    }
  },
};
