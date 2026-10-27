/** 复用完整 runner 的集成断言、浏览器设置和 finally 资源回收。 */
process.env.E2E_INTEGRATION_ONLY = '1';
await import('./run.mjs');
