import type Core from '../../src/core';
import type { Plugin } from '../../src/types';

/**
 * Test-only stand-in for the old `Core#use()` (removed along with
 * `PluginManager` — plugins now wire themselves onto `axios` directly via
 * `install(axios)`; `Axp.install` is the real orchestrator). Most tests here
 * don't care about the canonical order or need `AxpHandle`'s lookup/dispose
 * API, just "get these plugins onto this axios instance" — this is that,
 * nothing more.
 */
export function use(api: Core<any>, plugins: Plugin | Array<Plugin | null | undefined | false>): void {
  const list = Array.isArray(plugins) ? plugins : [plugins];
  for (const p of list) if (p) p.install(api.axios);
}
