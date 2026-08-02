"""物品状态字典（可在此扩展枚举值）。

v0.9.8 重设计：贴近实际使用——
- 在库（默认）
- 临期：即将到期需留意
- 定期处理：需要定期检查/处理
- 已处理：处理完毕（终态，标记后不再出现在提醒/列表中）
- 损坏丢弃：损坏需丢弃（终态）
"""
import enum


class ItemStatus(str, enum.Enum):
    IN_STOCK = "在库"
    EXPIRING = "临期"
    PERIODIC = "定期处理"
    PROCESSED = "已处理"
    DISCARDED = "损坏丢弃"


def status_value(s) -> str:
    """枚举安全取值：数据库读出的状态可能是枚举成员或原始字符串，统一返回显示值。"""
    return s.value if hasattr(s, "value") else str(s)
