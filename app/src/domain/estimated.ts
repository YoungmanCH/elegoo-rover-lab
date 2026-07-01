// estimated.ts — 「推定値」を実測と型で区別する opaque ブランド。中身は明示 unwrap を強制＝取り違え防止。
const EST: unique symbol = Symbol("estimated");     // 実 symbol（declare だと実行時に落ちる）
/** 推定値(指令からの dead-reckoning・ドリフト)。実測(センサー)と混ぜないための opaque マーカー。 */
export type Estimated<T> = { readonly [EST]: T };
/** 値を「推定」として封じる。 */
export function estimated<T>(v: T): Estimated<T> { return { [EST]: v } as Estimated<T>; }
/** 推定と承知で取り出す(呼ぶこと自体が「これは推定」の明示)。 */
export function takeEstimate<T>(e: Estimated<T>): T { return e[EST]; }
