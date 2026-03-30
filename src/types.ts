import type { LiteralUnion } from 'type-fest';

export type SabStatus =
  | 'Grabbing'
  | 'Queued'
  | 'Paused'
  | 'Checking'
  | 'Downloading'
  | 'QuickCheck'
  | 'Verifying'
  | 'Repairing'
  | 'Fetching'
  | 'Extracting'
  | 'Moving'
  | 'Running'
  | 'Completed'
  | 'Failed'
  | 'Deleted'
  | 'Propagating';

/**
 * Raw SABnzbd job status value from queue/history payloads.
 *
 * Use the documented `SabStatus` union when you want exhaustiveness over known
 * values. Raw payload fields remain open to unknown statuses so newer SABnzbd
 * releases do not become type-incompatible.
 */
export type SabRawStatus = LiteralUnion<SabStatus, string>;

/**
 * Documented queue status filter values accepted by `mode=queue`.
 */
export type SabQueueStatusFilter =
  | 'Checking'
  | 'Downloading'
  | 'Fetching'
  | 'Grabbing'
  | 'Paused'
  | 'Propagating'
  | 'Queued';

/**
 * Documented history status filter values accepted by `mode=history`.
 */
export type SabHistoryStatusFilter =
  | 'Completed'
  | 'Extracting'
  | 'Failed'
  | 'Fetching'
  | 'Moving'
  | 'Queued'
  | 'QuickCheck'
  | 'Repairing'
  | 'Running'
  | 'Verifying';

/**
 * Documented SABnzbd numeric priority values.
 */
export type SabPriorityValue = -100 | -4 | -3 | -2 | -1 | 0 | 1 | 2;

/**
 * Raw SABnzbd priority value from payloads, which may be numeric or stringified.
 */
export type SabRawPriorityValue = SabPriorityValue | `${SabPriorityValue}`;

/**
 * Documented SABnzbd queue post-processing values.
 */
export type SabPostProcessValue = -1 | 0 | 1 | 2 | 3;

/**
 * Raw SABnzbd queue post-processing value from payloads.
 */
export type SabRawPostProcessValue = SabPostProcessValue | `${SabPostProcessValue}`;

/**
 * Documented SABnzbd history post-processing status codes.
 */
export type SabHistoryPostProcessValue = 'R' | 'U' | 'D';

/**
 * File status values documented by SABnzbd.
 */
export type SabFileStatus = LiteralUnion<'finished' | 'active' | 'queued', string>;

export interface SabBooleanResponse {
  /**
   * True/False status returned by command-style endpoints.
   *
   * SAB docs note some endpoints may still return `true` even when the operation failed.
   */
  status: boolean;
  /**
   * Optional list of affected queue ids (`nzo_id` values), when provided by SAB.
   */
  nzo_ids?: string[];
  error?: string;
}

export interface SabAuthResponse {
  /**
   * Authentication mode information returned by `mode=auth`.
   */
  auth: string;
}

export interface SabVersionResponse {
  /**
   * SABnzbd version string returned by `mode=version`.
   */
  version: string;
}

export type SabWarningType = LiteralUnion<'WARNING' | 'ERROR', string>;

export interface SabWarning {
  text: string;
  type: SabWarningType;
  time: number;
}

export interface SabWarningsResponse {
  warnings: SabWarning[];
}

export interface SabCategoriesResponse {
  /**
   * Configured category names returned by `mode=get_cats`.
   */
  categories: string[];
}

export interface SabScriptsResponse {
  /**
   * Configured script names returned by `mode=get_scripts`.
   */
  scripts: string[];
}

export interface SabAddResponse {
  /**
   * True/False status for add operations (`mode=addurl` / `mode=addfile`).
   */
  status: boolean;
  /**
   * Added queue ids (`nzo_id` values). SAB docs describe this as the add result payload.
   */
  nzo_ids: string[];
  error?: string;
}

export interface SabSwitchResponse {
  result?: {
    /**
     * Job priority after move/switch.
     */
    priority: number;
    /**
     * Job position after move/switch.
     */
    position: number;
  };
}

export interface SabPositionResponse {
  /**
   * Queue position returned by priority updates, when provided by SAB.
   */
  position?: number;
}

export interface SabStatusConnection {
  thrdnum: number;
  nzo_name?: string;
  nzf_name?: string;
  art_name?: string;
}

export interface SabStatusServer {
  servername: string;
  servertotalconn: number;
  serverssl: number;
  serveractiveconn: number;
  serveroptional: number;
  serveractive: boolean;
  servererror: string;
  serverpriority: number;
  serverbps: string;
  serverconnections: SabStatusConnection[];
}

export interface SabQueueSlot {
  status: SabRawStatus;
  index: number;
  timeleft: string;
  /**
   * Total size in MB.
   */
  mb: string | number;
  filename: string;
  priority: SabRawPriorityValue;
  cat: string;
  /**
   * Remaining size in MB.
   */
  mbleft: string | number;
  percentage: string | number;
  nzo_id: string;
  /**
   * Optional UNIX timestamp when the job was added.
   */
  time_added?: number | string;
  script?: string;
  /**
   * Optional labels such as duplicate or propagation indicators.
   */
  labels?: string[];
  /**
   * Post-processing setting for the job.
   */
  pp?: SabRawPostProcessValue;
  /**
   * Post-processing options value.
   */
  unpackopts?: string;
}

export interface SabQueue {
  status: SabRawStatus;
  paused: boolean;
  timeleft: string;
  /**
   * Current speed display value.
   */
  speed?: string;
  kbpersec?: string | number;
  mb?: string | number;
  mbleft?: string | number;
  /**
   * Number of jobs in the current response.
   */
  noofslots?: string | number;
  /**
   * Total number of queue jobs.
   */
  noofslots_total?: string | number;
  /**
   * Start index used for paged queue responses.
   */
  start?: string | number;
  /**
   * Limit used for paged queue responses.
   */
  limit?: string | number;
  /**
   * Speed limit percentage configured by SAB.
   */
  speedlimit?: string | number;
  /**
   * Absolute speed limit in bytes per second.
   */
  speedlimit_abs?: string | number;
  slots: SabQueueSlot[];
  [key: string]: unknown;
}

export interface SabHistorySlot {
  fail_message?: string;
  bytes: string | number;
  category?: string;
  nzb_name?: string;
  download_time?: string | number;
  storage?: string;
  completed?: string | number;
  /**
   * UNIX timestamp when the job was added.
   */
  time_added?: string | number;
  /**
   * Duplicate matching key generated by SAB.
   */
  duplicate_key?: string;
  script?: string;
  /**
   * History post-processing status code (`R`, `U`, `D`).
   */
  pp?: SabHistoryPostProcessValue;
  /**
   * Temporary destination path.
   */
  path?: string;
  status: SabRawStatus;
  nzo_id: string;
  name: string;
  [key: string]: unknown;
}

export interface SabHistory {
  /**
   * Bytes downloaded in the current day.
   */
  day?: string | number;
  /**
   * Bytes downloaded in the current week.
   */
  week?: string | number;
  /**
   * Bytes downloaded in the current month.
   */
  month?: string | number;
  /**
   * Total bytes downloaded.
   */
  total?: string | number;
  slots: SabHistorySlot[];
  [key: string]: unknown;
}

export interface SabFullStatus {
  localipv4?: string;
  ipv6?: string | null;
  publicipv4?: string | null;
  dnslookup?: string;
  folders?: string[];
  cpumodel?: string;
  pystone?: number;
  loadavg?: string;
  downloaddir?: string;
  downloaddirspeed?: number;
  completedir?: string;
  completedirspeed?: number;
  loglevel?: string;
  logfile?: string;
  configfn?: string;
  nt?: boolean;
  darwin?: boolean;
  confighelpuri?: string;
  uptime?: string;
  color_scheme?: string;
  webdir?: string;
  active_lang?: string;
  restart_req?: boolean;
  power_options?: boolean;
  pp_pause_event?: boolean;
  pid?: number;
  weblogfile?: string | null;
  new_release?: boolean;
  new_rel_url?: string | null;
  have_warnings?: boolean | number | string;
  warnings?: SabWarning[];
  servers?: SabStatusServer[];
  [key: string]: unknown;
}

export interface SabFile {
  nzf_id: string;
  filename: string;
  /**
   * File state in a job (`finished`, `active`, `queued`).
   */
  status?: SabFileStatus;
  /**
   * File age display string.
   */
  age?: string;
  /**
   * Par2 set id when applicable.
   */
  set?: string;
  mbleft?: string | number;
  mb?: string | number;
  bytes?: string | number;
  [key: string]: unknown;
}

export interface SabFilesResponse {
  files: SabFile[];
}

export interface SabServerStatsServer {
  /**
   * Bytes downloaded in the current day.
   */
  day: number;
  /**
   * Bytes downloaded in the current week.
   */
  week: number;
  /**
   * Bytes downloaded in the current month.
   */
  month: number;
  /**
   * Total bytes downloaded.
   */
  total: number;
  /**
   * Per-day byte totals keyed by `YYYY-MM-DD`.
   */
  daily: Record<string, number>;
  /**
   * Number of articles requested from this server.
   */
  articles_tried: number;
  /**
   * Number of successful article downloads from this server.
   */
  articles_success: number;
}

export interface SabServerStats {
  /**
   * Bytes downloaded in the current day.
   */
  day: number;
  /**
   * Bytes downloaded in the current week.
   */
  week: number;
  /**
   * Bytes downloaded in the current month.
   */
  month: number;
  /**
   * Total bytes downloaded.
   */
  total: number;
  /**
   * Per-server transfer stats keyed by server name.
   */
  servers: Record<string, SabServerStatsServer>;
}

export interface SabQueueQuery {
  /**
   * Index of the first queue job to return.
   */
  start?: number;
  /**
   * Number of queue jobs to return.
   */
  limit?: number;
  /**
   * Queue name filter.
   */
  search?: string;
  /**
   * Category filter (`cat`/`category`).
   */
  category?: string | string[];
  /**
   * Priority filter.
   */
  priority?: SabPriorityValue | SabPriorityValue[];
  /**
   * Queue status filter.
   */
  status?: SabQueueStatusFilter | SabQueueStatusFilter[];
  /**
   * Filter by one or more queue ids (`nzo_ids`).
   */
  nzoIds?: string | string[];
}

export interface SabHistoryQuery {
  /**
   * Index of the first history item to return.
   */
  start?: number;
  /**
   * Number of history items to return.
   */
  limit?: number;
  /**
   * History name filter.
   */
  search?: string;
  /**
   * Category filter (`cat`/`category`).
   */
  category?: string | string[];
  /**
   * History status filter.
   */
  status?: SabHistoryStatusFilter | SabHistoryStatusFilter[];
  /**
   * Filter by one or more ids (`nzo_ids`).
   */
  nzoIds?: string | string[];
  /**
   * Only include failed items.
   */
  failedOnly?: boolean;
  /**
   * Select archived history output.
   */
  archived?: boolean;
  /**
   * Return full output only when history changed since this value.
   */
  lastHistoryUpdate?: number | string;
}

export interface SabAddOptions {
  category?: string;
  script?: string;
  priority?: SabPriorityValue;
  postProcess?: SabPostProcessValue;
  name?: string;
  password?: string;
}
