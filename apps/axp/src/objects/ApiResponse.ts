export default class ApiResponse<T extends any = any> {
  declare status: number;
  declare code: number | string;
  declare message: string | null;
  declare data: T | null;
  declare successful: boolean;

  constructor(status: number = 0, code: number | string = 0, message: string | null = null, data: T | null = null) {
    this.status = status;
    this.code = code;
    this.message = message;
    this.data = data;
    this.successful = status >= 200 && status < 300 && code === "0000";
  }

  static fromResponse(response: any): ApiResponse {
    const { status, data: { code, message, data } = {} } = response;
    return new ApiResponse(status, code, message, data);
  }
}
