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
  UsenetPriority,
} from '@ctrl/shared-usenet';
import type { Jsonify } from 'type-fest';

import {
  buildAddFileForm,
  getSabAddFields,
  normalizeAddOptions,
  normalizeAddPostProcess,
} from './addOptions.js';
import {
  normalizeSabHistoryItem,
  normalizeSabJob,
  normalizeSabStatus,
  normalizedPriorityToSab,
} from './normalizeUsenetData.js';
import { requestSab, type SabRequestOptions, type SabRequestParams } from './sabTransport.js';
import type {
  SabAddOptions,
  SabAddResponse,
  SabAuthResponse,
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
const addQueuePollAttempts = 40;
const addQueuePollIntervalMs = 250;

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

function isUsenetNotFoundError(error: unknown): error is UsenetNotFoundError {
  return error instanceof UsenetNotFoundError;
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
    return this.command({ mode: 'pause' });
  }

  /**
   * Resumes the global download queue.
   *
   * Calls SABnzbd `mode=resume`.
   *
   * @returns `true` when SABnzbd accepts the resume command.
   */
  async resumeQueue(): Promise<boolean> {
    return this.command({ mode: 'resume' });
  }

  /**
   * Requests SABnzbd shutdown.
   *
   * Calls SABnzbd `mode=shutdown`.
   *
   * @returns `true` when SABnzbd accepts the shutdown command.
   */
  async shutdown(): Promise<boolean> {
    return this.command({ mode: 'shutdown' });
  }

  /**
   * Requests a standard SABnzbd restart.
   *
   * Calls SABnzbd `mode=restart`.
   *
   * @returns `true` when SABnzbd accepts the restart command.
   */
  async restart(): Promise<boolean> {
    return this.command({ mode: 'restart' });
  }

  /**
   * Requests SABnzbd restart with queue repair.
   *
   * Calls SABnzbd `mode=restart_repair`.
   *
   * @returns `true` when SABnzbd accepts the repair restart command.
   */
  async restartRepair(): Promise<boolean> {
    return this.command({ mode: 'restart_repair' });
  }

  /**
   * Pauses post-processing tasks.
   *
   * Calls SABnzbd `mode=pause_pp`.
   *
   * @returns `true` when SABnzbd accepts the post-processing pause command.
   */
  async pausePostProcessing(): Promise<boolean> {
    return this.command({ mode: 'pause_pp' });
  }

  /**
   * Resumes post-processing tasks.
   *
   * Calls SABnzbd `mode=resume_pp`.
   *
   * @returns `true` when SABnzbd accepts the post-processing resume command.
   */
  async resumePostProcessing(): Promise<boolean> {
    return this.command({ mode: 'resume_pp' });
  }

  /**
   * Triggers immediate RSS processing.
   *
   * Calls SABnzbd `mode=rss_now`.
   *
   * @returns `true` when SABnzbd accepts the RSS trigger command.
   */
  async fetchRss(): Promise<boolean> {
    return this.command({ mode: 'rss_now' });
  }

  /**
   * Triggers an immediate scan of the watched folder.
   *
   * Calls SABnzbd `mode=watched_now`.
   *
   * @returns `true` when SABnzbd accepts the watched-folder scan command.
   */
  async scanWatchedFolder(): Promise<boolean> {
    return this.command({ mode: 'watched_now' });
  }

  /**
   * Resets SABnzbd quota counters.
   *
   * Calls SABnzbd `mode=reset_quota`.
   *
   * @returns `true` when SABnzbd accepts the quota reset command.
   */
  async resetQuota(): Promise<boolean> {
    return this.command({ mode: 'reset_quota' });
  }

  /**
   * Clears currently active warnings.
   *
   * Calls SABnzbd `mode=warnings` with `name=clear`.
   *
   * @returns `true` when SABnzbd accepts the warning clear command.
   */
  async clearWarnings(): Promise<boolean> {
    return this.command({ mode: 'warnings', name: 'clear' });
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
    return this.command({ mode: 'queue', name: 'pause', value: id });
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
    return this.command({ mode: 'queue', name: 'resume', value: id });
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
    return this.command({
      mode: 'queue',
      name: 'delete',
      value: id,
      del_files: deleteFiles ? '1' : '0',
    });
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
    return this.command({
      mode: 'switch',
      value: id,
      value2: `${position}`,
    });
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
    return this.command({
      mode: 'change_cat',
      value: id,
      value2: category,
    });
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
    return this.command({
      mode: 'change_script',
      value: id,
      value2: script,
    });
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
    return this.command({
      mode: 'change_opts',
      value: id,
      value2: `${normalizeAddPostProcess(postProcess)}`,
    });
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
    return this.command({
      mode: 'rename',
      value: id,
      value2: name,
      password,
    });
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
    return this.command({
      mode: 'config',
      name: 'speedlimit',
      value: `${limit}`,
    });
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
      ...getSabAddFields(options),
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
    const form = buildAddFileForm(this.config, nzb, options);
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
    const job = await this.findQueueJob(id);
    if (!job) {
      throw new UsenetNotFoundError('sabnzbd', 'queueJob', id);
    }

    return job;
  }

  async getHistoryJob(id: string): Promise<NormalizedUsenetHistoryItem> {
    const historyItem = await this.findHistoryJob(id);
    if (!historyItem) {
      throw new UsenetNotFoundError('sabnzbd', 'historyJob', id);
    }

    return historyItem;
  }

  async findJob(id: string): Promise<FoundUsenetJob | null> {
    const queueJob = await this.findQueueJob(id);
    if (queueJob) {
      return {
        source: 'queue',
        job: queueJob,
      };
    }

    const historyJob = await this.findHistoryJob(id);
    if (historyJob) {
      return {
        source: 'history',
        job: historyJob,
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
    const response = await this.addFile(nzb, normalizeAddOptions(options));
    return getAddedJobId(response);
  }

  async addNzbUrl(url: string, options: Partial<NormalizedAddNzbOptions> = {}): Promise<string> {
    const response = await this.addUrl(url, normalizeAddOptions(options));
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

    return this.waitForQueueJob(id);
  }

  private async waitForQueueJob(id: string): Promise<NormalizedUsenetJob> {
    for (let attempt = 0; attempt < addQueuePollAttempts; attempt++) {
      try {
        return await this.getQueueJob(id);
      } catch (error) {
        if (!isUsenetNotFoundError(error)) {
          throw error;
        }
      }

      if (attempt < addQueuePollAttempts - 1) {
        await sleep(addQueuePollIntervalMs);
      }
    }

    throw new UsenetNotFoundError('sabnzbd', 'queueJob', id);
  }

  private async findQueueJob(id: string): Promise<NormalizedUsenetJob | undefined> {
    const queue = await this.listQueue({ nzoIds: id });
    const slot = queue.slots.find(item => item.nzo_id === id);
    return slot ? normalizeSabJob(slot) : undefined;
  }

  private async findHistoryJob(id: string): Promise<NormalizedUsenetHistoryItem | undefined> {
    const history = await this.listHistory({ nzoIds: id });
    const item = history.slots.find(slot => slot.nzo_id === id);
    return item ? normalizeSabHistoryItem(item) : undefined;
  }

  private async command(params: SabRequestParams): Promise<boolean> {
    await this.request<unknown>(params);
    return true;
  }

  private async request<T>(params: SabRequestParams, options: SabRequestOptions = {}): Promise<T> {
    return requestSab<T>(this.config, params, options);
  }
}
