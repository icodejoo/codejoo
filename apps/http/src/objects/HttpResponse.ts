export default class HttpResponse<T = unknown> {
  declare status: number;
  declare code: number | string;
  declare message: string | null;
  declare data: T | null;

  constructor(
    status: number = 0,
    code: number | string = 0,
    message: string | null = null,
    data: T | null = null,
  ) {
    this.status = status;
    this.code = code;
    this.message = message;
    this.data = data;
  }

  static fromResponse(response: any): HttpResponse {
    const { status, data: responseData } = response;
    const { code, message, data } = responseData;
    return new HttpResponse(status, code, message, data);
  }
}
