function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip the configured model / provider / resource strings out of upstream error
 * text before it is thrown.
 *
 * NOT cosmetic. A thrown error here is routinely caught, stringified onto a record,
 * PERSISTED to a database and logged. Provider error bodies habitually echo the
 * deployment name back, which would put the model id in the logs and in the
 * database — and a source-only scan cannot see runtime strings, so redaction is the
 * only control that covers that path.
 *
 * The HTTP status is deliberately left untouched: it is the useful diagnostic and
 * it carries nothing.
 */
export function redact(text: string, values: Array<string | undefined>): string {
  let out = text;
  for (const value of values) {
    // Falsy entries must be skipped BEFORE the replace — an empty pattern matches
    // at every position and would shred the message into separator noise.
    if (!value) continue;
    out = out.replace(new RegExp(escapeRegExp(value), "gi"), "<redacted>");
  }
  return out;
}
