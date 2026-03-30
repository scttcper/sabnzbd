import {
  type AddNzbOptions as NormalizedAddNzbOptions,
  type AllClientData,
  type Category,
  type FoundUsenetJob,
  type NormalizedUsenetHistoryItem,
  type NormalizedUsenetJob,
  type NzbInput,
  type Script,
  type UsenetClient,
  type UsenetClientConfig,
  type UsenetClientState,
  UsenetNotFoundError,
  UsenetPostProcess,
  UsenetPriority,
} from '@ctrl/shared-usenet';
import { FormData } from 'node-fetch-native';
import { ofetch } from 'ofetch';
import type { Jsonify } from 'type-fest';
import { joinURL } from 'ufo';

import {
  normalizeSabHistoryItem,
  normalizeSabJob,
  normalizeSabStatus,
  normalizedPriorityToSab,
} from './normalizeUsenetData.js';
import type {
  SabAddOptions,
  SabAddResponse,
  SabAuthResponse,
  SabBooleanResponse,
  SabCategoriesResponse,
  SabFilesResponse,
  SabFullStatus,
  SabHistory,
  SabHistoryQuery,
  SabPositionResponse,
  SabQueue,
  SabQueueQuery,
  SabScriptsResponse,
  SabServerStats,
  SabSwitchResponse,
  SabVersionResponse,
  SabWarning,
  SabWarningsResponse,
} from './types.js';

interface SabnzbdState extends UsenetClientState {
  auth?: {
    apiKey?: string;
    nzbKey?: string;
  };
  version?: {
    version: string;
  };
}

const defaults: UsenetClientConfig = {
  baseUrl: 'http://localhost:8080/',
  path: '/api',
  username: '',
  password: '',
  timeout: 5000,
};

function toQueryStringValue(value: boolean | number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return `${value}`;
}

function toCommaList(
  value: string | number | Array<string | number> | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value.join(',') : `${value}`;
}

function normalizePostProcess(
  value: NormalizedAddNzbOptions['postProcess'] | SabAddOptions['postProcess'] | undefined,
): number {
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
      return Number(value);
    }
  }
}

function encodeNzbFile(file: string | Uint8Array): Uint8Array {
  if (typeof file === 'string') {
    return new TextEncoder().encode(file);
  }

  return file;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function getAddedJobId(response: SabAddResponse): string {
  const [id] = response.nzo_ids;
  if (!response.status || !id) {
    throw new Error(response.error ?? 'SABnzbd did not return a queue id');
  }

  return id;
}

function coercePriority(priority: UsenetPriority | number | undefined): UsenetPriority {
  if (typeof priority !== 'number') {
    return priority ?? UsenetPriority.default;
  }

  return priority <= -2
    ? UsenetPriority.paused
    : priority < 0
      ? UsenetPriority.low
      : priority === 0
        ? UsenetPriority.normal
        : priority === 1
          ? UsenetPriority.high
          : UsenetPriority.force;
}

export class Sabnzbd implements UsenetClient {
  static createFromState(
    config: Readonly<UsenetClientConfig>,
    state: Readonly<Jsonify<SabnzbdState>>,
  ): Sabnzbd {
    const client = new Sabnzbd(config);
    client.state = { ...state };
    return client;
  }

  config: UsenetClientConfig;
  state: SabnzbdState = {};

  constructor(options: Partial<UsenetClientConfig> = {}) {
    this.config = { ...defaults, ...options };
  }

  exportState(): Jsonify<SabnzbdState> {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Verifies configured credentials against the SABnzbd API.
   *
   * Calls SABnzbd `mode=auth`.
   *
   * @returns The raw SABnzbd authentication response.
   */
  async auth(): Promise<SabAuthResponse> {
    const response = await this.request<SabAuthResponse>({ mode: 'auth' });
    this.state.auth = {
      apiKey: this.config.apiKey,
      nzbKey: this.config.nzbKey,
    };
    return response;
  }

  /**
   * Reads the SABnzbd version string.
   *
   * Calls SABnzbd `mode=version`.
   *
   * @returns The SABnzbd version.
   */
  async getVersion(): Promise<string> {
    const response = await this.request<SabVersionResponse>({ mode: 'version' });
    this.state.version = { version: response.version };
    return response.version;
  }

  /**
   * Loads full server and queue status details from SABnzbd.
   *
   * Calls SABnzbd `mode=fullstatus` with `skip_dashboard=1`.
   *
   * @returns The full status payload.
   */
  async getFullStatus(): Promise<SabFullStatus> {
    return this.request<SabFullStatus>({ mode: 'fullstatus', skip_dashboard: '1' });
  }

  /**
   * Retrieves the current SABnzbd warning list.
   *
   * Calls SABnzbd `mode=warnings`.
   *
   * @returns All active warnings.
   */
  async getWarnings(): Promise<SabWarning[]> {
    const response = await this.request<SabWarningsResponse>({ mode: 'warnings' });
    return response.warnings;
  }

  /**
   * Retrieves per-server traffic totals from SABnzbd.
   *
   * Calls SABnzbd `mode=server_stats`.
   *
   * @returns Aggregate and per-server transfer statistics.
   */
  async getServerStats(): Promise<SabServerStats> {
    return this.request<SabServerStats>({ mode: 'server_stats' });
  }

  /**
   * Lists queue entries, optionally filtered and paged.
   *
   * Calls SABnzbd `mode=queue`.
   *
   * @param query Optional queue filters and pagination controls.
   * @returns The raw queue payload including `slots`.
   */
  async listQueue(query: SabQueueQuery = {}): Promise<SabQueue> {
    const response = await this.request<{ queue: SabQueue }>({
      mode: 'queue',
      start: toQueryStringValue(query.start),
      limit: toQueryStringValue(query.limit),
      search: query.search,
      category: toCommaList(query.category),
      priority: toCommaList(query.priority),
      status: toCommaList(query.status),
      nzo_ids: toCommaList(query.nzoIds),
    });

    return response.queue;
  }

  /**
   * Lists history entries, optionally filtered and paged.
   *
   * Calls SABnzbd `mode=history`.
   *
   * @param query Optional history filters, pagination, and archive controls.
   * @returns The raw history payload including `slots`.
   */
  async listHistory(query: SabHistoryQuery = {}): Promise<SabHistory> {
    const response = await this.request<{ history: SabHistory }>({
      mode: 'history',
      start: toQueryStringValue(query.start),
      limit: toQueryStringValue(query.limit),
      search: query.search,
      category: toCommaList(query.category),
      status: toCommaList(query.status),
      nzo_ids: toCommaList(query.nzoIds),
      failed_only: toQueryStringValue(query.failedOnly),
      archive: toQueryStringValue(query.archived),
      last_history_update: toQueryStringValue(query.lastHistoryUpdate),
    });

    return response.history;
  }

  /**
   * Retrieves configured SABnzbd categories.
   *
   * Calls SABnzbd `mode=get_cats`.
   *
   * @returns Categories normalized to shared `Category` objects.
   */
  async getCategories(): Promise<Category[]> {
    const response = await this.request<SabCategoriesResponse>({ mode: 'get_cats' });
    return response.categories.map(category => ({
      id: category,
      name: category,
    }));
  }

  /**
   * Retrieves configured SABnzbd post-processing scripts.
   *
   * Calls SABnzbd `mode=get_scripts`.
   *
   * @returns Scripts normalized to shared `Script` objects.
   */
  async getScripts(): Promise<Script[]> {
    const response = await this.request<SabScriptsResponse>({ mode: 'get_scripts' });
    return response.scripts.map(script => ({
      id: script,
      name: script,
    }));
  }

  /**
   * Pauses the global download queue.
   *
   * Calls SABnzbd `mode=pause`.
   *
   * @returns `true` when SABnzbd accepts the pause command.
   */
  async pauseQueue(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'pause' });
    return true;
  }

  /**
   * Resumes the global download queue.
   *
   * Calls SABnzbd `mode=resume`.
   *
   * @returns `true` when SABnzbd accepts the resume command.
   */
  async resumeQueue(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'resume' });
    return true;
  }

  /**
   * Requests SABnzbd shutdown.
   *
   * Calls SABnzbd `mode=shutdown`.
   *
   * @returns `true` when SABnzbd accepts the shutdown command.
   */
  async shutdown(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'shutdown' });
    return true;
  }

  /**
   * Requests a standard SABnzbd restart.
   *
   * Calls SABnzbd `mode=restart`.
   *
   * @returns `true` when SABnzbd accepts the restart command.
   */
  async restart(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'restart' });
    return true;
  }

  /**
   * Requests SABnzbd restart with queue repair.
   *
   * Calls SABnzbd `mode=restart_repair`.
   *
   * @returns `true` when SABnzbd accepts the repair restart command.
   */
  async restartRepair(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'restart_repair' });
    return true;
  }

  /**
   * Pauses post-processing tasks.
   *
   * Calls SABnzbd `mode=pause_pp`.
   *
   * @returns `true` when SABnzbd accepts the post-processing pause command.
   */
  async pausePostProcessing(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'pause_pp' });
    return true;
  }

  /**
   * Resumes post-processing tasks.
   *
   * Calls SABnzbd `mode=resume_pp`.
   *
   * @returns `true` when SABnzbd accepts the post-processing resume command.
   */
  async resumePostProcessing(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'resume_pp' });
    return true;
  }

  /**
   * Triggers immediate RSS processing.
   *
   * Calls SABnzbd `mode=rss_now`.
   *
   * @returns `true` when SABnzbd accepts the RSS trigger command.
   */
  async fetchRss(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'rss_now' });
    return true;
  }

  /**
   * Triggers an immediate scan of the watched folder.
   *
   * Calls SABnzbd `mode=watched_now`.
   *
   * @returns `true` when SABnzbd accepts the watched-folder scan command.
   */
  async scanWatchedFolder(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'watched_now' });
    return true;
  }

  /**
   * Resets SABnzbd quota counters.
   *
   * Calls SABnzbd `mode=reset_quota`.
   *
   * @returns `true` when SABnzbd accepts the quota reset command.
   */
  async resetQuota(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'reset_quota' });
    return true;
  }

  /**
   * Clears currently active warnings.
   *
   * Calls SABnzbd `mode=warnings` with `name=clear`.
   *
   * @returns `true` when SABnzbd accepts the warning clear command.
   */
  async clearWarnings(): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'warnings', name: 'clear' });
    return true;
  }

  /**
   * Pauses a queue job by its SAB `nzo_id`.
   *
   * Calls SABnzbd `mode=queue` with `name=pause`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @returns `true` when SABnzbd accepts the job pause command.
   */
  async pauseJob(id: string): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'queue', name: 'pause', value: id });
    return true;
  }

  /**
   * Resumes a queue job by its SAB `nzo_id`.
   *
   * Calls SABnzbd `mode=queue` with `name=resume`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @returns `true` when SABnzbd accepts the job resume command.
   */
  async resumeJob(id: string): Promise<boolean> {
    await this.request<SabBooleanResponse>({ mode: 'queue', name: 'resume', value: id });
    return true;
  }

  /**
   * Deletes a queue job by its SAB `nzo_id`.
   *
   * Calls SABnzbd `mode=queue` with `name=delete`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param deleteFiles When `true`, also remove downloaded data files; defaults to `false`.
   * @returns `true` when SABnzbd accepts the delete command.
   */
  async deleteJob(id: string, deleteFiles = false): Promise<boolean> {
    await this.request<SabBooleanResponse>({
      mode: 'queue',
      name: 'delete',
      value: id,
      del_files: deleteFiles ? '1' : '0',
    });
    return true;
  }

  /**
   * Moves a queue job to a target position.
   *
   * Calls SABnzbd `mode=switch`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param position Target zero-based queue position.
   * @returns `true` when SABnzbd accepts the move command.
   */
  async moveJob(id: string, position: number): Promise<boolean> {
    await this.request<SabSwitchResponse>({
      mode: 'switch',
      value: id,
      value2: `${position}`,
    });
    return true;
  }

  /**
   * Changes a queue job category.
   *
   * Calls SABnzbd `mode=change_cat`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param category SAB category name.
   * @returns `true` when SABnzbd accepts the category change.
   */
  async changeCategory(id: string, category: string): Promise<boolean> {
    await this.request<SabBooleanResponse>({
      mode: 'change_cat',
      value: id,
      value2: category,
    });
    return true;
  }

  /**
   * Changes a queue job post-processing script.
   *
   * Calls SABnzbd `mode=change_script`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param script SAB configured script name.
   * @returns `true` when SABnzbd accepts the script change.
   */
  async changeScript(id: string, script: string): Promise<boolean> {
    await this.request<SabBooleanResponse>({
      mode: 'change_script',
      value: id,
      value2: script,
    });
    return true;
  }

  /**
   * Changes queue job priority.
   *
   * Calls SABnzbd `mode=queue` with `name=priority`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param priority Shared normalized priority value.
   * @returns The new queue position when reported by SABnzbd, otherwise `undefined`.
   */
  async changePriority(id: string, priority: UsenetPriority): Promise<number | undefined> {
    const response = await this.request<SabPositionResponse>({
      mode: 'queue',
      name: 'priority',
      value: id,
      value2: `${normalizedPriorityToSab(priority)}`,
    });
    return response.position;
  }

  /**
   * Changes queue job post-processing options.
   *
   * Calls SABnzbd `mode=change_opts`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param postProcess Normalized post-processing mode to apply.
   * @returns `true` when SABnzbd accepts the option change.
   */
  async changePostProcess(
    id: string,
    postProcess: NormalizedAddNzbOptions['postProcess'],
  ): Promise<boolean> {
    await this.request<SabBooleanResponse>({
      mode: 'change_opts',
      value: id,
      value2: `${normalizePostProcess(postProcess)}`,
    });
    return true;
  }

  /**
   * Renames a queue job and optionally sets an archive password.
   *
   * Calls SABnzbd `mode=rename`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @param name New queue job name.
   * @param password Optional archive password; defaults to an empty string.
   * @returns `true` when SABnzbd accepts the rename command.
   */
  async renameJob(id: string, name: string, password = ''): Promise<boolean> {
    await this.request<SabBooleanResponse>({
      mode: 'rename',
      value: id,
      value2: name,
      password,
    });
    return true;
  }

  /**
   * Lists files for a queue job.
   *
   * Calls SABnzbd `mode=get_files`.
   *
   * @param id SAB queue job identifier (`nzo_id`).
   * @returns The raw file listing payload.
   */
  async getFiles(id: string): Promise<SabFilesResponse> {
    return this.request<SabFilesResponse>({ mode: 'get_files', value: id });
  }

  /**
   * Sets the global download speed limit.
   *
   * Calls SABnzbd `mode=config` with `name=speedlimit`.
   *
   * @param limit Speed limit value passed directly to SABnzbd.
   * @returns `true` when SABnzbd accepts the speed limit update.
   */
  async setSpeedLimit(limit: string | number): Promise<boolean> {
    await this.request<SabBooleanResponse>({
      mode: 'config',
      name: 'speedlimit',
      value: `${limit}`,
    });
    return true;
  }

  /**
   * Adds an NZB to the queue from a URL.
   *
   * Calls SABnzbd `mode=addurl`.
   *
   * @param url Remote NZB URL.
   * @param options Optional SAB add fields; defaults include `category="*"`, `script="Default"`,
   * `priority=-100`, and `postProcess=-1`.
   * @returns The raw SAB add response containing status and optional `nzo_ids`.
   */
  async addUrl(url: string, options: SabAddOptions = {}): Promise<SabAddResponse> {
    const response = await this.request<SabAddResponse>({
      mode: 'addurl',
      name: url,
      nzbname: options.name ?? '',
      password: options.password ?? '',
      cat: options.category ?? '*',
      script: options.script ?? 'Default',
      priority: `${options.priority ?? -100}`,
      pp: `${options.postProcess ?? -1}`,
    });

    return response;
  }

  /**
   * Adds an NZB to the queue by file upload.
   *
   * Calls SABnzbd `mode=addfile`.
   *
   * @param nzb NZB XML content as text or bytes.
   * @param options Optional SAB add fields; defaults include `category="*"`, `script="Default"`,
   * `priority=-100`, and `postProcess=-1`.
   * @returns The raw SAB add response containing status and optional `nzo_ids`.
   */
  async addFile(nzb: string | Uint8Array, options: SabAddOptions = {}): Promise<SabAddResponse> {
    const form = new FormData();
    form.append('mode', 'addfile');
    form.append('output', 'json');
    form.append('nzbname', options.name ?? '');
    form.append('password', options.password ?? '');
    form.append('cat', options.category ?? '*');
    form.append('script', options.script ?? 'Default');
    form.append('priority', `${options.priority ?? -100}`);
    form.append('pp', `${options.postProcess ?? -1}`);

    if (this.config.apiKey) {
      form.append('apikey', this.config.apiKey);
    } else if (this.config.nzbKey) {
      form.append('nzbkey', this.config.nzbKey);
    } else {
      form.append('ma_username', this.config.username ?? '');
      form.append('ma_password', this.config.password ?? '');
    }

    const filename = options.name?.endsWith('.nzb')
      ? options.name
      : `${options.name ?? 'upload'}.nzb`;
    form.append(
      'name',
      new Blob([Buffer.from(encodeNzbFile(nzb))], { type: 'application/x-nzb+xml' }),
      filename,
    );

    return this.request<SabAddResponse>({}, { method: 'POST', body: form });
  }

  async getQueue(): Promise<NormalizedUsenetJob[]> {
    const queue = await this.listQueue();
    return queue.slots.map(normalizeSabJob);
  }

  async getHistory(): Promise<NormalizedUsenetHistoryItem[]> {
    const history = await this.listHistory();
    return history.slots.map(normalizeSabHistoryItem);
  }

  async getQueueJob(id: string): Promise<NormalizedUsenetJob> {
    const queue = await this.listQueue({ nzoIds: id });
    const job = queue.slots.find(slot => slot.nzo_id === id);
    if (!job) {
      throw new UsenetNotFoundError('sabnzbd', 'queueJob', id);
    }

    return normalizeSabJob(job);
  }

  async getHistoryJob(id: string): Promise<NormalizedUsenetHistoryItem> {
    const history = await this.listHistory({ nzoIds: id });
    const historyItem = history.slots.find(item => item.nzo_id === id);
    if (!historyItem) {
      throw new UsenetNotFoundError('sabnzbd', 'historyJob', id);
    }

    return normalizeSabHistoryItem(historyItem);
  }

  async findJob(id: string): Promise<FoundUsenetJob | null> {
    const queue = await this.listQueue({ nzoIds: id });
    const queueJob = queue.slots.find(slot => slot.nzo_id === id);
    if (queueJob) {
      return {
        source: 'queue',
        job: normalizeSabJob(queueJob),
      };
    }

    const history = await this.listHistory({ nzoIds: id });
    const historyJob = history.slots.find(item => item.nzo_id === id);
    if (historyJob) {
      return {
        source: 'history',
        job: normalizeSabHistoryItem(historyJob),
      };
    }

    return null;
  }

  async getAllData(): Promise<AllClientData> {
    const [queue, history, fullStatus, categories, scripts] = await Promise.all([
      this.listQueue(),
      this.listHistory(),
      this.getFullStatus(),
      this.getCategories(),
      this.getScripts(),
    ]);

    return {
      categories,
      scripts,
      queue: queue.slots.map(normalizeSabJob),
      history: history.slots.map(normalizeSabHistoryItem),
      status: normalizeSabStatus(queue, fullStatus),
      raw: {
        queue,
        history,
        fullStatus,
      },
    };
  }

  async removeJob(id: string, removeData = false): Promise<boolean> {
    return this.deleteJob(id, removeData);
  }

  async setCategory(id: string, category: string): Promise<boolean> {
    return this.changeCategory(id, category);
  }

  async setPriority(id: string, priority: UsenetPriority): Promise<boolean> {
    await this.changePriority(id, priority);
    return true;
  }

  async addNzbFile(
    nzb: string | Uint8Array,
    options: Partial<NormalizedAddNzbOptions> = {},
  ): Promise<string> {
    const response = await this.addFile(nzb, this.normalizeAddOptions(options));
    return getAddedJobId(response);
  }

  async addNzbUrl(url: string, options: Partial<NormalizedAddNzbOptions> = {}): Promise<string> {
    const response = await this.addUrl(url, this.normalizeAddOptions(options));
    return getAddedJobId(response);
  }

  async normalizedAddNzb(
    input: NzbInput,
    options: Partial<NormalizedAddNzbOptions> = {},
  ): Promise<NormalizedUsenetJob> {
    const id =
      'url' in input
        ? await this.addNzbUrl(input.url, options)
        : await this.addNzbFile(input.file, options);

    for (let attempt = 0; attempt < 10; attempt++) {
      const queue = await this.listQueue({ nzoIds: id });
      const job = queue.slots.find(slot => slot.nzo_id === id);
      if (job) {
        return normalizeSabJob(job);
      }

      await sleep(250);
    }

    throw new Error('Unable to load newly added SABnzbd job');
  }

  private normalizeAddOptions(options: Partial<NormalizedAddNzbOptions>): SabAddOptions {
    return {
      category: options.category ?? '*',
      script: options.postProcessScript ?? 'Default',
      priority: normalizedPriorityToSab(
        options.startPaused ? UsenetPriority.paused : coercePriority(options.priority),
      ),
      postProcess: normalizePostProcess(options.postProcess),
      name: options.name,
      password: options.password,
    };
  }

  private async request<T>(
    params: Record<string, string | undefined>,
    options: {
      method?: 'GET' | 'POST';
      body?: BodyInit;
    } = {},
  ): Promise<T> {
    const url = joinURL(this.config.baseUrl, this.config.path ?? '/api');
    const query =
      options.method === 'POST'
        ? undefined
        : {
            output: 'json',
            ...this.getAuthQuery(),
            ...params,
          };

    const response = await ofetch<T>(url, {
      method: options.method ?? 'GET',
      body: options.body,
      query,
      dispatcher: this.config.dispatcher,
      timeout: this.config.timeout,
    });

    this.assertSabResponse(response);
    return response;
  }

  private getAuthQuery(): Record<string, string> {
    if (this.config.apiKey) {
      return { apikey: this.config.apiKey };
    }

    if (this.config.nzbKey) {
      return { nzbkey: this.config.nzbKey };
    }

    return {
      ma_username: this.config.username ?? '',
      ma_password: this.config.password ?? '',
    };
  }

  private assertSabResponse(response: unknown): void {
    if (!response || typeof response !== 'object') {
      return;
    }

    if ('status' in response && response.status === false) {
      const error =
        'error' in response && typeof response.error === 'string'
          ? response.error
          : 'SABnzbd returned status=false';
      throw new Error(error);
    }
  }
}
