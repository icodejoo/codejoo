import {
  Http,
  httpAuthenticatorPlugin,
  httpNormalizerPlugin,
  httpResolverPlugin,
  httpFilterPlugin,
  TokenManager,
  HttpResponse,
} from "../";

export const tokenManager = new TokenManager();
export const httpNormalizer = httpNormalizerPlugin();
export const httpFilter = httpFilterPlugin({ debug: true });
export const httpResolver = httpResolverPlugin();

const path = "/token";
export const httpAuthenticator = httpAuthenticatorPlugin({
  tokenManager,
  shouldPassThrough: (config) => config.url === path,
  isTokenExpired: (response) => response.status === 401,
  onRefreshToken(response, tokenManager, http) {
    return http
      .request<HttpResponse>({
        ...response.config,
        url: path,
        method: "post",
        data: { refreshToken: tokenManager.refreshToken },
      })
      .then((r) => {
        if (r.data.data) return r.data.data as any;
        return Promise.reject(new Error("Failed to refresh token"));
      });
  },
  setAuthorization(config, tokenManager) {
    if (tokenManager.accessToken) {
      config.headers.setAuthorization(tokenManager.accessToken);
    } else {
      delete config.headers.Authorization;
    }
  },
  shouldRefreshToken(config, tokenManager) {
    /// 只有当请求的token和当前token一致时才刷新token
    /// 否则直接使用当前token重放请求
    return config.headers.Authorization !== tokenManager.accessToken;
  },
});

export const http = new Http({
  baseURL: "/api",
  responseType: "json",
  adapter: "fetch",
  timeout: 15 * 1000,
  timeoutErrorMessage: "Request timeout, please try again later",
});

http.plugin(httpFilter).plugin(httpNormalizer).plugin(httpAuthenticator);
// .plugin(httpResolver);

console.log(http);
