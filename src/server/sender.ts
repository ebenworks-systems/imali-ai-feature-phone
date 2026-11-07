/**
 * Sends a text message through Africa's Talking.
 *
 * One POST to `<host>/version1/messaging` with the form fields username, to, message and from, and the headers
 * `apiKey` and `Accept: application/json`. The sandbox host is used when the username is `sandbox`.
 *
 * Errors name a status or a recipient code and never the API key, the message text or the response body.
 */

export interface SmsSender {
  send(to: string, message: string): Promise<void>;
}

export interface AfricasTalkingOptions {
  username: string;
  apiKey: string;
  /** The short code the text comes from (the `from` field). */
  shortcode: string;
  /** Tests pass a fake. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** How long to wait for Africa's Talking. Defaults to 5 seconds. */
  timeoutMs?: number;
}

export function africasTalkingHost(username: string): string {
  return username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
}

export function createAfricasTalkingSender(options: AfricasTalkingOptions): SmsSender {
  const { username, shortcode } = options;
  const apiKey = options.apiKey;
  const timeoutMs = options.timeoutMs ?? 5000;
  const doFetch = options.fetch ?? globalThis.fetch;
  const url = `${africasTalkingHost(username)}/version1/messaging`;

  return {
    async send(to: string, message: string): Promise<void> {
      const body = new URLSearchParams({ username, to, message, from: shortcode });
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      // The timer rejects on its own, so a fetch that ignores the abort signal still cannot hold the caller up.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Africa's Talking did not answer in time"));
        }, timeoutMs);
      });

      const work = (async () => {
        let response: Response;
        try {
          response = await doFetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              apiKey
            },
            body: body.toString(),
            signal: controller.signal
          });
        } catch {
          // The cause is dropped on purpose: it can carry request details.
          throw new Error("Africa's Talking could not be reached");
        }
        if (response.status < 200 || response.status > 299) {
          throw new Error(`Africa's Talking refused the text (status ${response.status})`);
        }
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new Error("Africa's Talking gave an answer that could not be read");
        }
        const recipients = (data as { SMSMessageData?: { Recipients?: unknown } } | null)?.SMSMessageData?.Recipients;
        if (Array.isArray(recipients)) {
          for (const recipient of recipients) {
            const code = Number((recipient as { statusCode?: unknown } | null)?.statusCode);
            if (Number.isFinite(code) && code >= 400) {
              throw new Error(`Africa's Talking refused the text (recipient code ${code})`);
            }
          }
        }
      })();
      work.catch(() => {}); // when the timer wins, a late failure must not become an unhandled rejection

      try {
        await Promise.race([work, timeout]);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
