import { AxiosError } from 'axios';
import ApiResponse from '../objects/ApiResponse';
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';


const name = 'normalize-response'
/** Strict variant of `normalize` — wraps `response.data` in an `ApiResponse`
 *  instance, throws when `successful === false`, and ensures errors carry an
 *  `ApiResponse` payload too. */
export default function normalizeResponse(
  { enable = true }: INormalizeResponseOptions = {},
): Plugin {
  return {
    name: name,
    install(ctx) {
      if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`)
      ctx.response(
        function $normalize(response) {
          response.data = ApiResponse.fromResponse(response);
          if ((response.data as ApiResponse).successful) return response;
          return Promise.reject(response);
        },
        function $normalize(error: unknown) {
          const err = error as AxiosError;
          err.response ||= {
            data: null,
            status: err.status || 0,
            statusText: err.message,
            headers: err.config?.headers || {},
            config: err.config || ({} as never),
            request: err.request,
          };
          err.response.data = ApiResponse.fromResponse(err.response);
          return Promise.reject(err);
        },
      );
    },
  };
}

normalizeResponse.name = name

export interface INormalizeResponseOptions {
  enable?: boolean,
  nullable?: boolean
}

declare module "../types" {
  interface ICommonOptions {
    normalize: MaybeFun<INormalizeResponseOptions | boolean | Falsy>
  }
}

declare module "axios" {
  interface InternalAxiosRequestConfig {
    normalize?: INormalizeResponseOptions
  }
}