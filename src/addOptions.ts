import {
  type AddNzbOptions as NormalizedAddNzbOptions,
  type UsenetClientConfig,
  UsenetPostProcess,
  UsenetPriority,
} from '@ctrl/shared-usenet';
import { FormData } from 'node-fetch-native';

import { normalizedPriorityToSab } from './normalizeUsenetData.js';
import { appendSabAuthFields } from './sabTransport.js';
import type { SabAddOptions, SabPostProcessValue, SabPriorityValue } from './types.js';

interface SabAddFields {
  nzbname: string;
  password: string;
  cat: string;
  script: string;
  priority: string;
  pp: string;
}

interface ResolvedSabAddOptions {
  category: string;
  script: string;
  priority: SabPriorityValue;
  postProcess: SabPostProcessValue;
  name: string;
  password: string;
}

const defaultSabAddOptions: ResolvedSabAddOptions = {
  category: '*',
  script: 'Default',
  priority: -100,
  postProcess: -1,
  name: '',
  password: '',
};

function normalizePostProcess(
  value: NormalizedAddNzbOptions['postProcess'] | SabAddOptions['postProcess'] | undefined,
): SabPostProcessValue {
  switch (value) {
    case undefined:
    case UsenetPostProcess.default: {
      return -1;
    }
    case UsenetPostProcess.none: {
      return 0;
    }
    case UsenetPostProcess.repair: {
      return 1;
    }
    case UsenetPostProcess.repairUnpack: {
      return 2;
    }
    case UsenetPostProcess.repairUnpackDelete: {
      return 3;
    }
    default: {
      if (!Number.isInteger(value)) {
        throw new TypeError(`SAB post-process value must be an integer, received: ${value}`);
      }

      if (value < -1 || value > 3) {
        throw new RangeError(`Unsupported SAB post-process value: ${value}`);
      }

      return value;
    }
  }
}

function coercePriority(priority: UsenetPriority | SabPriorityValue | undefined): UsenetPriority {
  if (priority === undefined) {
    return UsenetPriority.default;
  }

  if (typeof priority !== 'number') {
    return priority;
  }

  if (!Number.isInteger(priority)) {
    throw new TypeError(`SAB priority must be an integer, received: ${priority}`);
  }

  switch (priority) {
    case -100: {
      return UsenetPriority.default;
    }
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
    default: {
      throw new RangeError(`Unsupported SAB priority value: ${priority}`);
    }
  }
}

function encodeNzbFile(file: string | Uint8Array): Uint8Array {
  if (typeof file === 'string') {
    return new TextEncoder().encode(file);
  }

  return file;
}

export function normalizeAddOptions(options: Partial<NormalizedAddNzbOptions>): SabAddOptions {
  const priority = options.startPaused ? UsenetPriority.paused : coercePriority(options.priority);

  return {
    category: options.category,
    script: options.postProcessScript,
    priority: normalizedPriorityToSab(priority),
    postProcess: normalizePostProcess(options.postProcess),
    name: options.name,
    password: options.password,
  };
}

export function normalizeAddPostProcess(
  value: NormalizedAddNzbOptions['postProcess'] | SabAddOptions['postProcess'] | undefined,
): SabPostProcessValue {
  return normalizePostProcess(value);
}

function resolveSabAddOptions(options: SabAddOptions): ResolvedSabAddOptions {
  return {
    category: options.category ?? defaultSabAddOptions.category,
    script: options.script ?? defaultSabAddOptions.script,
    priority: options.priority ?? defaultSabAddOptions.priority,
    postProcess: options.postProcess ?? defaultSabAddOptions.postProcess,
    name: options.name ?? defaultSabAddOptions.name,
    password: options.password ?? defaultSabAddOptions.password,
  };
}

export function getSabAddFields(options: SabAddOptions): SabAddFields {
  const resolved = resolveSabAddOptions(options);

  return {
    nzbname: resolved.name,
    password: resolved.password,
    cat: resolved.category,
    script: resolved.script,
    priority: `${resolved.priority}`,
    pp: `${resolved.postProcess}`,
  };
}

function getUploadFilename(name: string): string {
  if (!name) {
    return 'upload.nzb';
  }

  return name.endsWith('.nzb') ? name : `${name}.nzb`;
}

export function buildAddFileForm(
  config: Readonly<UsenetClientConfig>,
  nzb: string | Uint8Array,
  options: SabAddOptions,
): FormData {
  const fields = getSabAddFields(options);
  const form = new FormData();
  form.append('mode', 'addfile');
  form.append('output', 'json');

  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }

  appendSabAuthFields(form, config);

  form.append(
    'name',
    new Blob([Buffer.from(encodeNzbFile(nzb))], { type: 'application/x-nzb+xml' }),
    getUploadFilename(fields.nzbname),
  );

  return form;
}
