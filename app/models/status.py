"""物品状态字典（可在此扩展枚举值）。"""
import enum


class ItemStatus(str, enum.Enum):
    IN_STOCK = "在库"
    BORROWED = "已借出"
    DAMAGED = "损坏"
    PENDING = "待处理"
    DISCARDED = "已丢弃"
    CLEANED = "已清理"
