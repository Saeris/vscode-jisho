/**
 * 注文処理のユーティリティ。
 *
 * 在庫を確認してから決済に進みます。在庫が足りない場合はエラーを返します。
 */

// 在庫を確認してから決済に進みます
// ^ A top-level comment, unindented and outside any string, so the documentation screenshot can
//   hover a known character offset and get the dictionary's hover rather than TypeScript's.

interface Order {
  /** 商品コード */
  sku: string;
  /** 注文数量 */
  quantity: number;
}

const MESSAGES = {
  outOfStock: "申し訳ありませんが、在庫が不足しています。",
  paymentFailed: "決済に失敗しました。もう一度お試しください。",
  confirmed: "ご注文ありがとうございます。"
} as const;

/** 在庫を確認します。足りなければ false を返します。 */
export const hasStock = (order: Order, available: number): boolean =>
  available >= order.quantity;

/**
 * 注文を確定します。
 *
 * 決済が完了すると確認メールを送信します。
 */
export const submitOrder = (order: Order, available: number): string => {
  if (!hasStock(order, available)) {
    // 在庫切れの場合はここで処理を中断する
    return MESSAGES.outOfStock;
  }
  return MESSAGES.confirmed;
};

/**
 * Markdown inside a doc comment, which is what JSDoc actually contains in the wild.
 *
 * **在庫**を確認します。`注文` を確定します。
 *
 * - 決済に進みます
 * - [注文](./order.md) を参照。
 *
 * ```ts
 * const 変数 = "在庫";
 * ```
 *
 * 送信します。
 */
export const notifyCustomer = (order: Order): void => {
  void order;
};
