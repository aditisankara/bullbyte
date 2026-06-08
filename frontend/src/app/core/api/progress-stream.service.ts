import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ProgressEvent,
  SSE_EVENTS,
  isTerminal,
} from '../../shared/analysis/progress-event';

/**
 * Minimal structural type for what we use of the native EventSource, so specs
 * can substitute a fake without touching the global.
 */
export interface ProgressEventSource {
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
  close(): void;
}

/**
 * Seam for `new EventSource(url)` — injected so specs never open a real
 * connection (same test-seam pattern as 6.1's interceptor-backed specs).
 */
export const EVENT_SOURCE_FACTORY = new InjectionToken<
  (url: string) => ProgressEventSource
>('EVENT_SOURCE_FACTORY', {
  providedIn: 'root',
  factory: () => (url: string) => new EventSource(url),
});

/**
 * ProgressStreamService — typed client for the 5.2 SSE endpoint
 * `GET /api/v1/jobs/:jobId/progress`.
 *
 * The server sends *named* events (`type` = the kebab-case event name), so
 * `onmessage` never fires — a listener is registered per `SSE_EVENTS` name.
 *
 * The EventSource is closed client-side as soon as a terminal event arrives:
 * the browser auto-reconnects whenever the server ends the stream, and 5.2's
 * already-terminal snapshot would otherwise re-emit `analysis-complete` in a
 * loop. Mid-run drops still benefit from the built-in auto-reconnect (5.2's
 * subject-per-job re-attaches), so reconnection is not disabled — only the
 * terminal close is forced. Unsubscribing also closes the connection, which
 * makes component teardown structurally leak-free (AC5).
 */
@Injectable({ providedIn: 'root' })
export class ProgressStreamService {
  private readonly createEventSource = inject(EVENT_SOURCE_FACTORY);

  /**
   * Stream the progress events for a job. Completes after the terminal event
   * (`analysis-complete` / `analysis-failed`); the terminal event itself is
   * delivered to subscribers before completion.
   */
  connect(jobId: string): Observable<ProgressEvent> {
    return new Observable<ProgressEvent>((subscriber) => {
      const url = `${environment.apiBaseUrl}/jobs/${encodeURIComponent(jobId)}/progress`;
      const source = this.createEventSource(url);

      for (const name of SSE_EVENTS) {
        source.addEventListener(name, (message) => {
          const event = JSON.parse(message.data) as ProgressEvent;
          subscriber.next(event);
          if (isTerminal(event.event)) {
            source.close(); // before complete(), so teardown's close() is a no-op
            subscriber.complete();
          }
        });
      }

      return () => source.close();
    });
  }
}
