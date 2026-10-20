/**
 * A stand-in XMLHttpRequest for the image upload tests. jsdom's XHR cannot send a FormData holding a
 * Blob through MSW (the request never settles), and a test-driven one also lets a test report upload
 * progress, answer late, or watch a cancelled upload being aborted.
 */
import { vi } from "vitest";

export class FakeXhr {
  static sent: FakeXhr[] = [];

  method = "";
  url = "";
  withCredentials = false;
  body: unknown = null;
  aborted = false;
  status = 0;
  statusText = "";
  responseText = "";
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: unknown): void {
    this.body = body;
    FakeXhr.sent.push(this);
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  /** The form field `name` of the body sent. */
  field(name: string): FormDataEntryValue | null {
    return this.body instanceof FormData ? this.body.get(name) : null;
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }

  respond(status: number, body: unknown, statusText = ""): void {
    this.status = status;
    this.statusText = statusText;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }

  failToConnect(): void {
    this.onerror?.();
  }
}

/** Replaces XMLHttpRequest for this test (vi.unstubAllGlobals() puts it back); returns the requests sent. */
export function installFakeXhr(): FakeXhr[] {
  FakeXhr.sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return FakeXhr.sent;
}
