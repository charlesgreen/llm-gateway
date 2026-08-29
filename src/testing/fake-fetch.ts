import type { FetchInitLike, FetchLike } from "../types.js";

export interface CapturedRequest {
  url: string;
  init: FetchInitLike;
}

/** What the fake should answer with. Every field has a sane default. */
export interface CannedResponse {
  ok?: boolean;
  status?: number;
  /** Parsed body, returned from `json()` and stringified for `text()`. */
  body?: unknown;
  /** Raw body text, overriding the stringified `body` — for error-path cases. */
  text?: string;
}

export interface FakeFetch {
  /** Pass this as `fetchImpl`. */
  readonly fetchImpl: FetchLike;
  /** Every request the client made, in order. */
  readonly requests: CapturedRequest[];
  /** The single request the client should have made; throws if there was not exactly one. */
  only(): CapturedRequest;
  /** The headers of that single request. */
  headers(): Record<string, string>;
  /** The parsed JSON body of that single request. */
  body(): Record<string, unknown>;
}

const DEFAULT_BODY = {
  choices: [{ message: { content: '{"ok":true}' } }],
  usage: { prompt_tokens: 1200, completion_tokens: 300 },
};

/**
 * A fetch double that RECORDS the call and replays a canned chat-completions body.
 *
 * This is the seam that keeps a consumer's suite hermetic: no network call, no
 * credential, no spend. Shipping it here means each repo does not hand-roll a
 * slightly different fake that drifts from the real client's behaviour.
 */
export function fakeFetch(response: CannedResponse = {}): FakeFetch {
  const requests: CapturedRequest[] = [];

  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({ url, init });
    const payload = response.body ?? DEFAULT_BODY;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      async text() {
        return response.text ?? JSON.stringify(payload);
      },
      async json() {
        return payload;
      },
    };
  };

  function only(): CapturedRequest {
    if (requests.length !== 1) {
      throw new Error(`expected exactly one request, captured ${requests.length}`);
    }
    return requests[0] as CapturedRequest;
  }

  return {
    fetchImpl,
    requests,
    only,
    headers: () => only().init.headers,
    body: () => JSON.parse(only().init.body) as Record<string, unknown>,
  };
}
