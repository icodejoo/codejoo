import { AxiosError } from "axios";
import { AxiosInstance, AxiosRequestConfig } from "axios";
import HttpResponse from "./objects/HttpResponse";

export interface HttpPlugin {
  id: string;
  install(http: AxiosInstance): () => void;
  // uninstall(http: AxiosInstance): void;
}

export interface HttpOptions {
  /** 是否允许空值，如果为 false，则在数据为空时会抛出错误到catch流程 */
  nullable?: boolean;

  /** 是否过滤掉falsy值（null、undefined、0、false、""等），默认true */
  filterable?: boolean;

  /** 是否开启调试模式，开启后会在控制台输出请求和响应的详细信息，默认false */
  debug?: boolean;
}

export type HttpError = Required<AxiosError<HttpResponse>>;

declare module "axios" {
  export interface AxiosRequestConfig extends HttpOptions {}
}
