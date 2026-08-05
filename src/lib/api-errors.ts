// Turning a failure into something an analyst can act on.
//
// The trap this exists to close: for an Anthropic `APIError`, `err.message` IS the raw
// JSON body. A transient overload therefore renders as
//   {"type":"error","error":{...,"message":"Overloaded"},"request_id":"req_011Cdj…"}
// in the middle of a transcript, as though the assistant had said it. Every route that
// talks to the model funnels its errors through here instead, and every client guards
// whatever the server sent before painting it.

import Anthropic from "@anthropic-ai/sdk";

/**
 * A short sentence describing what happened and what to do — never the SDK's own text.
 *
 * `subject` names the thing that failed ("The scan", "The assistant") so one helper can
 * serve every route.
 */
export function friendlyApiError(err: unknown, subject = "The assistant"): string {
  if (err instanceof Anthropic.APIError) {
    // A mid-stream failure arrives as an SSE error frame after the HTTP 200, so
    // `status` is undefined and only `type` identifies it.
    const kind = (err as { type?: string }).type ?? "";
    const status = err.status ?? 0;
    if (status === 429 || kind === "rate_limit_error")
      return `${subject} is being rate limited right now. Give it a few seconds and try again.`;
    if (status >= 500 || kind === "overloaded_error" || kind === "api_error")
      return `The model service is temporarily busy. This is transient — try again in a moment.`;
    if (status === 401 || status === 403)
      return `${subject} could not authenticate with the model service. Check the API key configured for this deployment.`;
    if (status === 413) return `That request is too large to process. Narrow it and try again.`;
    if (status === 400 && /prompt is too long|context/i.test(err.message))
      return `This conversation has grown past the model's context. Start a new one, or ask a narrower question.`;
    if (status >= 400) return `${subject} could not process that request. Try rephrasing it.`;
  }
  if (err instanceof Anthropic.APIConnectionError)
    return `Could not reach the model service. Check your connection and try again.`;

  const raw = err instanceof Error ? err.message : "";
  if (/prompt is too long|context/i.test(raw))
    return `This request exceeded the model's context. Narrow it — name the company, period and exact metric.`;
  return `${subject} hit an unexpected error. Please try again.`;
}

/** Transient conditions worth another attempt. */
export function isRetryableApiError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const kind = (err as { type?: string }).type ?? "";
    return err.status === 429 || (err.status ?? 0) >= 500 || kind === "overloaded_error" || kind === "api_error" || kind === "rate_limit_error";
  }
  return false;
}

/** Backoff between attempts, in ms — one entry per retry. */
export const API_RETRY_BACKOFF_MS = [1500, 4000, 9000];

/**
 * Last line of defence on the client. Even with the routes fixed, an error string can
 * reach the UI from somewhere unaudited — a proxy, a gateway, a future route — so
 * nothing raw-looking is ever painted.
 */
export function safeErrorText(value: unknown, fallback = "Something went wrong. Please try again."): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return fallback;
  const looksRaw =
    s.startsWith("{") ||
    s.startsWith("[") ||
    s.startsWith("<") ||
    /"request_id"|request_id:|\brequest_id\b/.test(s) ||
    /\b(stack|at\s+\w+\s+\()/.test(s) ||
    /https?:\/\//.test(s) ||
    /sk-ant-|api[_-]?key/i.test(s) ||
    s.length > 320;
  return looksRaw ? fallback : s;
}
