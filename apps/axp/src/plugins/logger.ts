import type { Plugin, PluginLogger } from '../types';
import { CONSOLE_LOGGER } from '../helper';

const name = 'axp:logger';

/**
 * 给其它插件提供"要不要打日志、打到哪"的共享配置，直接写在 `axios.defaults.debug`/`axios.defaults.logger` 上（其它插件 install 时读 defaults，运行时读 `config.debug`/`config.logger`——二者同源，靠 axios 的 defaults 合并机制继承，因此支持按请求覆盖）。不装此插件时其它插件读到的都是 `undefined`，日志调用等效 no-op。跟 dioman 的 `DiomanLog`（往响应体里塞文字日志）不是一回事——本插件不产生任何拦截器，纯粹只设两个共享字段。
 *
 * Gives other plugins shared "whether/where to log" config by writing directly onto `axios.defaults.debug`/`axios.defaults.logger` (others read `axios.defaults` at install time and `config.debug`/`config.logger` at runtime — same underlying value, inherited via axios's own defaults-merge, hence overridable per request). Without this plugin the others just read `undefined` and their log calls are no-ops. Not the same as dioman's `DiomanLog` (which writes logs into the response body) — this plugin registers no interceptors, it only sets two shared fields.
 *
 * @param options 插件配置，见 {@link ILoggerOptions} / plugin options, see {@link ILoggerOptions}
 */
export default function axpLogger({ debug = false, logger = CONSOLE_LOGGER }: ILoggerOptions = {}): Plugin {
  return {
    name,
    install(axios) {
      const prevDebug = axios.defaults.debug;
      const prevLogger = axios.defaults.logger;
      axios.defaults.debug = debug;
      axios.defaults.logger = logger;
      return () => {
        axios.defaults.debug = prevDebug;
        axios.defaults.logger = prevLogger;
      };
    },
  };
}

export interface ILoggerOptions {
  /** 打开后其它插件的诊断日志才会输出，默认 `false` / other plugins' diagnostic logs only print once this is on, default `false` */
  debug?: boolean;
  /** 日志 sink，默认 `console.*` / the log sink, default `console.*` */
  logger?: PluginLogger;
}

declare module 'axios' {
  interface AxiosRequestConfig {
    /** 是否输出诊断日志，继承自 `axios.defaults.debug`，可按请求覆盖 / whether to log, inherited from `axios.defaults.debug`, overridable per request */
    debug?: boolean;
    /** 日志 sink，继承自 `axios.defaults.logger`，可按请求覆盖 / log sink, inherited from `axios.defaults.logger`, overridable per request */
    logger?: PluginLogger;
  }
}
