import type { UsenetClientConfig } from '@ctrl/shared-usenet';
import { ofetch } from 'ofetch';
import { joinURL } from 'ufo';

export type SabRequestParams = Record<string, string | undefined>;

export interface SabRequestOptions {
  method?: 'GET' | 'POST';
  body?: BodyInit;
  /**
   * Return `status: false` responses without an `error` instead of throwing, for endpoints
   * that use it to report "nothing matched".
   */
  allowFalseStatus?: boolean;
}

export function getSabAuthParams(config: Readonly<UsenetClientConfig>): Record<string, string> {
  if (config.apiKey) {
    return { apikey: config.apiKey };
  }

  if (config.nzbKey) {
    return { nzbkey: config.nzbKey };
  }

  return {
    ma_username: config.username ?? '',
    ma_password: config.password ?? '',
  };
}

export function appendSabAuthFields(
  form: { append(name: string, value: string): void },
  config: Readonly<UsenetClientConfig>,
): void {
  for (const [name, value] of Object.entries(getSabAuthParams(config))) {
    form.append(name, value);
  }
}

export function assertSabResponse(response: unknown, allowFalseStatus = false): void {
  if (!response || typeof response !== 'object') {
    return;
  }

  if ('status' in response && response.status === false) {
    const error = 'error' in response && typeof response.error === 'string' ? response.error : '';
    if (error || !allowFalseStatus) {
      throw new Error(error || 'SABnzbd returned status=false');
    }
  }
}

export async function requestSab<T>(
  config: Readonly<UsenetClientConfig>,
  params: SabRequestParams,
  options: SabRequestOptions = {},
): Promise<T> {
  const url = joinURL(config.baseUrl, config.path ?? '/api');
  const query =
    options.method === 'POST'
      ? undefined
      : {
          output: 'json',
          ...getSabAuthParams(config),
          ...params,
        };

  const response = await ofetch<T>(url, {
    method: options.method ?? 'GET',
    body: options.body,
    query,
    dispatcher: config.dispatcher,
    timeout: config.timeout,
  });

  assertSabResponse(response, options.allowFalseStatus);
  return response;
}
