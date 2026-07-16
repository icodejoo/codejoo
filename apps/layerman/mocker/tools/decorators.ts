const authMeta  = new WeakMap<object, boolean>()
const routeMeta = new WeakMap<object, { method: string; path: string }>()

type MethodDecoratorFn = (
  target: object,
  key: string | symbol,
  descriptor: PropertyDescriptor,
) => PropertyDescriptor

// ── @auth ─────────────────────────────────────────────────────────────────────

export function auth(enabled?: boolean): MethodDecoratorFn
export function auth(target: object, key: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor
export function auth(
  enabledOrTarget?: boolean | object,
  propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor,
): MethodDecoratorFn | PropertyDescriptor {
  if (propertyKey !== undefined) {
    // Bare usage: @auth  →  defaults to true
    authMeta.set(descriptor!.value as object, true)
    return descriptor!
  }
  const enabled = (enabledOrTarget as boolean | undefined) ?? true
  return (_target, _key, desc) => {
    authMeta.set(desc.value as object, enabled)
    return desc
  }
}

export function getAuthEnabled(fn: object): boolean | undefined {
  return authMeta.get(fn)
}

// ── @get('/path')  @post('/path')  … ─────────────────────────────────────────

function makeFactory(method: string) {
  return (path: string): MethodDecoratorFn =>
    (_target, _key, descriptor) => {
      routeMeta.set(descriptor.value as object, { method, path })
      return descriptor
    }
}

export const get     = makeFactory('GET')
export const post    = makeFactory('POST')
export const put     = makeFactory('PUT')
export const patch   = makeFactory('PATCH')
export const del     = makeFactory('DELETE')
export const head    = makeFactory('HEAD')
export const options = makeFactory('OPTIONS')

export function getRouteMeta(fn: object): { method: string; path: string } | undefined {
  return routeMeta.get(fn)
}
