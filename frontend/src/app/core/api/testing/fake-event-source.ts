import { Provider } from '@angular/core';
import { EVENT_SOURCE_FACTORY, ProgressEventSource } from '../progress-stream.service';
import { ProgressEvent, SseEventName } from '../../../shared/analysis/progress-event';

/**
 * Test double for the native EventSource (6.2). Records listeners per named
 * event and lets specs dispatch `ProgressEvent`s as the 5.2 server would.
 */
export class FakeEventSource implements ProgressEventSource {
  closed = false;
  private readonly listeners = new Map<
    string,
    ((event: MessageEvent<string>) => void)[]
  >();

  constructor(readonly url: string) {}

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  /** Dispatch a named SSE frame exactly as the browser would deliver it. */
  emit(event: ProgressEvent): void {
    for (const listener of this.listeners.get(event.event) ?? []) {
      listener({ data: JSON.stringify(event) } as MessageEvent<string>);
    }
  }
}

/** Canonical `ProgressEvent` fixture. */
export function progressEvent(
  event: SseEventName,
  overrides: Partial<ProgressEvent> = {},
): ProgressEvent {
  return {
    event,
    jobId: 'job-1',
    stepIndex: 1,
    totalSteps: 5,
    message: `step: ${event}`,
    timestamp: '2026-06-07T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * TestBed provider for `EVENT_SOURCE_FACTORY` that records every opened
 * connection into the given array, newest last.
 */
export function provideFakeEventSource(sources: FakeEventSource[]): Provider {
  return {
    provide: EVENT_SOURCE_FACTORY,
    useValue: (url: string) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
  };
}
