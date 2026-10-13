/** web-types.json 的文件名（相对包根） */
export const WEB_TYPES_FILE: string;
/** html-custom-data.json 的文件名（相对包根） */
export const CUSTOM_DATA_FILE: string;
/**
 * 生成 Web-Types（WebStorm）内容
 * @param version 包版本
 * @returns 可序列化的对象
 */
export function buildWebTypes(version: string): Record<string, unknown>;
/**
 * 生成 VS Code HTML Custom Data 内容
 * @returns 可序列化的对象
 */
export function buildCustomData(): Record<string, unknown>;
