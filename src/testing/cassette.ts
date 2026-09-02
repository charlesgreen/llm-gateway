import type { GenerateRequest, GenerateResult, ModelClient, Usage } from "../types.js";

export interface CassetteEntry {
  text: string;
  usage?: Partial<Usage>;
}

export interface CassetteClient extends ModelClient {
  /** Every request the subject under test made, in order. */
  readonly calls: GenerateRequest[];
}

function toEntry(value: string | CassetteEntry): CassetteEntry {
  return typeof value === "string" ? { text: value } : value;
}

function toResult(entry: CassetteEntry): GenerateResult {
  return {
    text: entry.text,
    usage: {
      inputTokens: entry.usage?.inputTokens ?? 0,
      outputTokens: entry.usage?.outputTokens ?? 0,
    },
  };
}

/**
 * A `ModelClient` that replays canned responses — the double a caller injects so
 * its own golden tests run with zero network and zero spend.
 *
 * A single entry replays on every call. An ARRAY is consumed in order and THROWS
 * once exhausted rather than quietly repeating: a test that makes more calls than
 * it scripted has changed behaviour, and silently serving it the last response
 * again would hide exactly that.
 */
export function cassetteClient(
  script: string | CassetteEntry | Array<string | CassetteEntry>,
): CassetteClient {
  const calls: GenerateRequest[] = [];
  const isSequence = Array.isArray(script);
  const entries = (isSequence ? script : [script]).map(toEntry);
  let next = 0;

  return {
    calls,
    async generate(req) {
      calls.push(req);
      if (!isSequence) return toResult(entries[0] as CassetteEntry);
      const entry = entries[next++];
      if (!entry) {
        throw new Error(
          `cassetteClient: no response scripted for call ${next} (${entries.length} scripted)`,
        );
      }
      return toResult(entry);
    },
  };
}
