import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import type { ITokenManager } from "../objects/TokenManager";
import type { HttpError, HttpPlugin } from "../types";

interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface HttpAuthOptions {
  /** Token管理器，负责token的增删改查，需要实现ITokenManager接口 */
  tokenManager: ITokenManager;
  /** 判断请求是否强制放行，通常用于放行token刷新接口，避免阻塞刷新流程 */
  shouldPassThrough(config: InternalAxiosRequestConfig): boolean;
  /** 判断请求的token是否过期 */
  isTokenExpired: (response: AxiosResponse, tokenManager: ITokenManager) => boolean;
  /** 判断已过期的请求是否需要刷新token */
  shouldRefreshToken: (config: InternalAxiosRequestConfig, tokenManager: ITokenManager) => boolean;
  /** 满足token刷新条件时的回调，需自行实现刷新逻辑 */
  onRefreshToken(
    response: AxiosResponse,
    tokenManager: ITokenManager,
    http: AxiosInstance,
  ): Promise<RefreshTokenResponse>;
  /** 设置请求配置中的鉴权参数 */
  setAuthorization: (config: InternalAxiosRequestConfig, tokenManager: ITokenManager) => void;
}

export default function ({
  tokenManager,
  onRefreshToken,
  isTokenExpired,
  shouldPassThrough,
  setAuthorization,
  shouldRefreshToken,
}: HttpAuthOptions): HttpPlugin {
  let qid = -1;
  let rid = -1;
  let promise1: Promise<any> | null = null;
  let promise2: Promise<RefreshTokenResponse> | null = null;

  return {
    id: "http-auth",
    install(http) {
      qid = http.interceptors.request.use(async function $authenticate(config) {
        if (promise2 && !shouldPassThrough(config)) {
          promise1 ||= Promise.resolve(promise2)
            .catch((e) => e)
            .finally(() => (promise1 = null));
          await promise1;
        }
        setAuthorization(config, tokenManager);
        return config;
      });

      // rid = http.interceptors.response.use(null, async function $authenticate(e: HttpError) {
      //   if (promise) {
      //     await promise;
      //   }
      //   const { config, response } = e;
      //   console.log(config.url);

      //   if (config.url === "/token") {
      //     console.log(response);
      //   }

      //   if (response.status !== 401) return Promise.reject(e);

      //   if (config.url === "/token") return Promise.reject(e);

      //   if (!tokenManager.canRefresh) return Promise.reject(e);

      //   if (config._retry) return Promise.reject(e);

      //   config._retry = true;

      //   const requestToken = config.headers.Authorization;
      //   const currentToken = tokenManager.accessToken;

      //   if (requestToken !== currentToken) {
      //     setAuthorization(config, tokenManager);
      //     return http.request(config);
      //   }

      //   try {
      //     promise ||= axios
      //       .post("/api/token", { refreshToken: tokenManager.refreshToken })
      //       .then((r) => {
      //         console.log(r.data.data);

      //         if (r.data.data) {
      //           tokenManager.set(r.data.data.accessToken,r.data.data.refreshToken)
      //           return r.data.data;
      //         };
      //         return Promise.reject(new Error("Failed to refresh token"));
      //       })
      //       .catch((error) => {
      //         tokenManager.canRefresh = false;
      //         tokenManager.clear();
      //         console.log("跳转登录页");
      //         throw error;
      //       })
      //       .finally(() => (promise = null));

      //     await promise;

      //     setAuthorization(config, tokenManager);

      //     return http.request(config);
      //   } catch (error) {
      //     console.log("跳转登录页");
      //     return Promise.reject(error)
      //   }
      // });

      rid = http.interceptors.response.use(null, async function $authenticate(e: HttpError) {
        const { config, response } = e;

        if (!isTokenExpired(response, tokenManager) || shouldPassThrough(config)) {
          return Promise.reject(e);
        }

        if (promise2) await promise2;

        if (!tokenManager.canRefresh) return Promise.reject(e);

        if (shouldRefreshToken(config, tokenManager)) {
          setAuthorization(config, tokenManager);
          return http.request(config);
        }

        promise2 = onRefreshToken(response, tokenManager, http).finally(() => (promise2 = null));
        try {
          const r = await promise2;
          tokenManager.set(r.accessToken, r.refreshToken);
          setAuthorization(config, tokenManager);
          return http.request(config);
        } catch (error) {
          tokenManager.clear();
          tokenManager.canRefresh = false;
          return Promise.reject(e);
        }
      });

      return () => {
        http.interceptors.request.eject(qid);
        http.interceptors.response.eject(rid);
      };
    },
  };
}
