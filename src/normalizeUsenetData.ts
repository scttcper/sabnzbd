import {
  type NormalizedUsenetHistoryItem,
  type NormalizedUsenetJob,
  type NormalizedUsenetStatus,
  UsenetJobState,
  UsenetPriority,
  UsenetStateMessage,
} from '@ctrl/shared-usenet';

import type {
  SabFullStatus,
  SabHistorySlot,
  SabPriorityValue,
  SabRawPriorityValue,
  SabQueue,
  SabQueueSlot,
  SabRawStatus,
} from './types.js';

const BYTES_PER_MEGABYTE = 1024 * 1024;

function toNumber(value: number | string | undefined): number {
  const parsed = Number.parseFloat(String(value ?? '0').replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function megabytesToBytes(value: number | string | undefined): number {
  return Math.round(toNumber(value) * BYTES_PER_MEGABYTE);
}

function parseSabDuration(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parts = value.split(':').map(part => Number.parseInt(part, 10));
  if (parts.some(part => Number.isNaN(part))) {
    return 0;
  }

  if (parts.length === 3) {
    const [hours = 0, minutes = 0, seconds = 0] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  if (parts.length === 2) {
    const [minutes = 0, seconds = 0] = parts;
    return minutes * 60 + seconds;
  }

  return parts[0] ?? 0;
}

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const numericValue = Number(value);
    if (numericValue > 0) {
      const timestamp = numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
      return new Date(timestamp).toISOString();
    }
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }

  return undefined;
}

export function sabPriorityToNormalized(priority: SabRawPriorityValue | undefined): UsenetPriority {
  const normalized = Number.parseInt(String(priority ?? UsenetPriority.default), 10);

  switch (normalized) {
    case -4: {
      return UsenetPriority.stopped;
    }
    case -3: {
      return UsenetPriority.duplicate;
    }
    case -2: {
      return UsenetPriority.paused;
    }
    case -1: {
      return UsenetPriority.low;
    }
    case 0: {
      return UsenetPriority.normal;
    }
    case 1: {
      return UsenetPriority.high;
    }
    case 2: {
      return UsenetPriority.force;
    }
    case -100: {
      return UsenetPriority.default;
    }
    default: {
      return UsenetPriority.default;
    }
  }
}

export function normalizedPriorityToSab(priority: UsenetPriority | undefined): SabPriorityValue {
  switch (priority) {
    case UsenetPriority.stopped: {
      return -4;
    }
    case UsenetPriority.duplicate: {
      return -3;
    }
    case UsenetPriority.paused: {
      return -2;
    }
    case UsenetPriority.veryLow: {
      return -1;
    }
    case UsenetPriority.low: {
      return -1;
    }
    case UsenetPriority.normal: {
      return 0;
    }
    case UsenetPriority.high: {
      return 1;
    }
    case UsenetPriority.veryHigh: {
      return 1;
    }
    case UsenetPriority.force: {
      return 2;
    }
    case UsenetPriority.default:
    default: {
      return -100;
    }
  }
}

function mapSabStatus(
  status: SabRawStatus,
  failMessage = '',
): Pick<NormalizedUsenetJob, 'state' | 'stateMessage'> {
  switch (status) {
    case 'Grabbing': {
      return { state: UsenetJobState.grabbing, stateMessage: UsenetStateMessage.grabbing };
    }
    case 'Queued': {
      return { state: UsenetJobState.queued, stateMessage: UsenetStateMessage.queued };
    }
    case 'Paused': {
      return { state: UsenetJobState.paused, stateMessage: UsenetStateMessage.paused };
    }
    case 'Downloading': {
      return {
        state: UsenetJobState.downloading,
        stateMessage: UsenetStateMessage.downloading,
      };
    }
    case 'Fetching': {
      return {
        state: UsenetJobState.downloading,
        stateMessage: UsenetStateMessage.downloading,
      };
    }
    case 'Propagating': {
      return {
        state: UsenetJobState.downloading,
        stateMessage: UsenetStateMessage.downloading,
      };
    }
    case 'Checking':
    case 'QuickCheck':
    case 'Verifying':
    case 'Repairing':
    case 'Extracting':
    case 'Moving':
    case 'Running': {
      return {
        state: UsenetJobState.postProcessing,
        stateMessage: UsenetStateMessage.postProcessing,
      };
    }
    case 'Completed': {
      return { state: UsenetJobState.completed, stateMessage: UsenetStateMessage.completed };
    }
    case 'Failed': {
      return {
        state: failMessage ? UsenetJobState.error : UsenetJobState.warning,
        stateMessage: failMessage ? UsenetStateMessage.failed : UsenetStateMessage.warning,
      };
    }
    case 'Deleted': {
      return { state: UsenetJobState.deleted, stateMessage: UsenetStateMessage.deleted };
    }
    default: {
      return { state: UsenetJobState.unknown, stateMessage: UsenetStateMessage.unknown };
    }
  }
}

export function normalizeSabJob(slot: SabQueueSlot): NormalizedUsenetJob {
  const { state, stateMessage } = mapSabStatus(slot.status);
  const totalSize = megabytesToBytes(slot.mb);
  const remainingSize = megabytesToBytes(slot.mbleft);
  const progress = toNumber(slot.percentage);

  return {
    id: slot.nzo_id,
    name: slot.filename,
    progress,
    isCompleted: progress >= 100,
    category: slot.cat || '',
    priority: sabPriorityToNormalized(slot.priority),
    state,
    stateMessage,
    downloadSpeed: 0,
    eta: parseSabDuration(slot.timeleft),
    queuePosition: slot.index,
    totalSize,
    remainingSize,
    savePath: undefined,
    postProcessScript: slot.script,
    raw: slot,
  };
}

export function normalizeSabHistoryItem(item: SabHistorySlot): NormalizedUsenetHistoryItem {
  const { state, stateMessage } = mapSabStatus(item.status, item.fail_message);
  const totalSize = toNumber(item.bytes);
  const succeeded = state === UsenetJobState.completed;

  return {
    id: item.nzo_id,
    name: item.name || item.nzb_name || item.nzo_id,
    progress: succeeded ? 100 : 0,
    isCompleted: succeeded,
    category: item.category || '',
    priority: undefined,
    state,
    stateMessage,
    downloadSpeed: 0,
    eta: 0,
    queuePosition: -1,
    totalSize,
    remainingSize: 0,
    savePath: item.storage,
    dateCompleted: normalizeIsoDate(item.completed),
    postProcessScript: item.script,
    failureMessage: item.fail_message,
    storagePath: item.storage,
    succeeded,
    raw: item,
  };
}

export function normalizeSabStatus(
  queue: SabQueue,
  fullStatus: SabFullStatus,
): NormalizedUsenetStatus {
  return {
    isDownloadPaused: Boolean(queue.paused),
    speedBytesPerSecond: Math.round(toNumber(queue.kbpersec) * 1024),
    totalRemainingSize: megabytesToBytes(queue.mbleft),
    completeDir: fullStatus.completedir,
    raw: {
      queue,
      fullStatus,
    },
  };
}
