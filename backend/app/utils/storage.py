from __future__ import annotations

import httpx

from ..config import settings


class StorageNotFoundError(FileNotFoundError):
    pass


class SupabaseStorage:
    """Thin wrapper around the Supabase Storage REST API — httpx direct, no SDK.

    Only a handful of primitive operations are needed here, so the SDK's extra
    abstraction/versioning isn't worth the dependency; this can be swapped later
    without touching call sites since they only depend on this interface.
    """

    def __init__(self, base_url: str, service_role_key: str, bucket: str):
        self._base = base_url.rstrip("/")
        self._bucket = bucket
        self._headers = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
        }

    def _object_url(self, key: str) -> str:
        return f"{self._base}/storage/v1/object/{self._bucket}/{key}"

    def read_bytes(self, key: str) -> bytes:
        resp = httpx.get(self._object_url(key), headers=self._headers, timeout=60.0)
        if resp.status_code == 404:
            raise StorageNotFoundError(key)
        resp.raise_for_status()
        return resp.content

    def write_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        headers = {**self._headers, "Content-Type": content_type, "x-upsert": "true"}
        resp = httpx.post(self._object_url(key), headers=headers, content=data, timeout=120.0)
        resp.raise_for_status()

    def delete(self, key: str) -> None:
        resp = httpx.delete(self._object_url(key), headers=self._headers, timeout=30.0)
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()

    def exists(self, key: str) -> bool:
        try:
            self.read_bytes(key)
            return True
        except StorageNotFoundError:
            return False

    def move(self, src_key: str, dst_key: str) -> None:
        resp = httpx.post(
            f"{self._base}/storage/v1/object/move",
            headers={**self._headers, "Content-Type": "application/json"},
            json={"bucketId": self._bucket, "sourceKey": src_key, "destinationKey": dst_key},
            timeout=60.0,
        )
        resp.raise_for_status()

    def stat(self, key: str) -> dict | None:
        parent, _, name = key.rpartition("/")
        resp = httpx.post(
            f"{self._base}/storage/v1/object/list/{self._bucket}",
            headers={**self._headers, "Content-Type": "application/json"},
            json={"prefix": parent, "search": name},
            timeout=30.0,
        )
        resp.raise_for_status()
        for item in resp.json():
            if item.get("name") == name:
                return item
        return None


_storage: SupabaseStorage | None = None


def get_storage() -> SupabaseStorage:
    global _storage
    if _storage is None:
        _storage = SupabaseStorage(
            settings.supabase_url, settings.supabase_service_role_key, settings.storage_bucket
        )
    return _storage
