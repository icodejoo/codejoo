export abstract class Typeof {
  static toString(value: unknown): string {
    return Object.prototype.toString.call(value);
  }
  static isObject(value: unknown): value is Record<string, unknown> {
    return this.toString(value) === "[object Object]";
  }
  static isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
    return (typeof value !== "object" && typeof value !== "function") || value === null;
  }
}
