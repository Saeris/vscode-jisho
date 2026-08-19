# 在庫を確認してから決済に進みます
MESSAGE = "申し訳ありませんが、在庫が不足しています。"


def has_stock(sku, available):
    """在庫を確認します。足りなければ False を返します。"""
    return available > 0
