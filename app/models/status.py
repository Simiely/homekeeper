"""物品状态字典（可在此扩展枚举值）。"""
import enum


class ItemStatus(str, enum.Enum):
    IN_STOCK = "在库"
    BORROWED = "已借出"
    DAMAGED = "损坏"
    PENDING = "待处理"
    DISCARDED = "已丢弃"
    CLEANED = "已清理"


def status_value(s) -> str:
    """枚举安全取值：数据库读出的状态可能是枚举成员或原始字符串，统一返回显示值。"""
    return s.value if hasattr(s, "value") else str(s)
