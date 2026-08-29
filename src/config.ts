import type { GatewayConfig } from "./types.js";

/**
 * Committed scaffold configs carry `<set-at-provision>`-shaped placeholders for the
 * values only the owner can supply. A PLACEHOLDER IS NOT A VALUE: forwarding one
 * upstream produces an input-rejection that reads like a broken call and is
 * actually an unfilled variable — a long walk for a one-line fix. Anything wrapped
 * in angle brackets is treated as unset. (DESIGN.md §1.5)
 */
const PLACEHOLDER = /^<.*>$/;

/**
 * Thrown when a required value is absent or is still an unfilled placeholder.
 *
 * Carries the config `field` so a caller can branch on WHICH value was wrong
 * without parsing the message.
 */
export class GatewayConfigError extends Error {
  readonly field: keyof GatewayConfig;

  constructor(message: string, field: keyof GatewayConfig) {
    super(message);
    this.name = "GatewayConfigError";
    this.field = field;
  }
}

/** Thrown when the gateway answers with a non-2xx. The body is REDACTED first. */
export class GatewayResponseError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GatewayResponseError";
    this.status = status;
  }
}

export function isConfigured(value: string | undefined): value is string {
  const v = value?.trim();
  return !!v && !PLACEHOLDER.test(v);
}

/**
 * An OPTIONAL value: absent and unfilled are indistinguishable, so both become
 * `undefined`. This matters most for the resource name, where letting a
 * placeholder through would select the wrong URL shape.
 */
export function configuredOrUndefined(value: string | undefined): string | undefined {
  return isConfigured(value) ? value.trim() : undefined;
}

/**
 * The label an error uses for a config field: the consumer's own variable name
 * when a `varNames` map supplies one, otherwise the field name itself. Still
 * actionable without the map, just less specific.
 */
export function labelFor(config: GatewayConfig, field: keyof GatewayConfig): string {
  return config.varNames?.[field] ?? field;
}

/**
 * A REQUIRED value: absent and unfilled are both hard errors, NAMED so that the
 * error message is the fix. Only the placeholder text is ever echoed back — never
 * a real configured value, which is the whole point of the redaction rule.
 */
export function requireConfigured(
  config: GatewayConfig,
  field: keyof GatewayConfig,
  what: string,
): string {
  const label = labelFor(config, field);
  const raw = config[field];
  const v = typeof raw === "string" ? raw.trim() : undefined;
  if (!v) throw new GatewayConfigError(`${label} is not set (${what})`, field);
  if (PLACEHOLDER.test(v)) {
    throw new GatewayConfigError(
      `${label} is still the unfilled placeholder "${v}" (${what})`,
      field,
    );
  }
  return v;
}
