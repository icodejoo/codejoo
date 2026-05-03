// Shared test helpers — keep individual *.test.ts files focused on assertions
// rather than HTTP setup boilerplate.

import axios, { type AxiosInstance } from 'axios';
import { create } from '../../src';
import type Core from '../../src/core/core';
import { startServer, type ServerHandle } from '../../server';

export interface IntegrationHarness {
    server: ServerHandle;
    baseURL: string;
    ax: AxiosInstance;
    api: Core;
}

export async function startHarness(): Promise<IntegrationHarness> {
    const server = await startServer();
    const baseURL = `http://localhost:${server.port}`;
    const ax = axios.create({ baseURL });
    const api = create(ax);
    return { server, baseURL, ax, api };
}

export async function stopHarness(h: IntegrationHarness | undefined) {
    if (!h) return;
    try { await h.server.close(); } catch { /* noop */ }
}

/** Reset a single counter on the server — convenience for retry/cache tests. */
export async function resetCounter(baseURL: string, key: string) {
    await axios.post(`${baseURL}/flaky/reset?key=${encodeURIComponent(key)}`);
}
