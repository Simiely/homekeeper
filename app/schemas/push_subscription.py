"""推送订阅 Schema。"""
from pydantic import BaseModel


class SubscribeBody(BaseModel):
    endpoint: str
    auth_key: str
    p256dh_key: str
