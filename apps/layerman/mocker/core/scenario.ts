let current: string | null = null

export function scenario(name: string): boolean { return current === name }
export function getScenario(): string | null { return current }
export function setScenario(name: string | null): void { current = name }
export function resetScenario(): void { current = null }
