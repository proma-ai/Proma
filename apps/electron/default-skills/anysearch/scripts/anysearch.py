"""Proma 内置 AnySearch Skill 的无第三方依赖 REST 客户端。"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import ipaddress
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


API_ORIGIN = "https://api.anysearch.com"
TIMEOUT_SECONDS = 30
MAX_RESPONSE_BYTES = 2_000_000
CLIENT_ID = "proma-skill/1.0.0"
SEARCH_FIELDS = {"query", "max_results", "tag", "params", "zone", "language"}


class AnySearchError(Exception):
    """可安全展示的请求错误，不包含查询、密钥或服务端原始正文。"""


def public_url(value: str) -> str:
    """Extract 只接受公开 HTTP(S) 地址，避免把本地地址传给远端解析服务。"""
    if not isinstance(value, str) or not value.strip():
        raise AnySearchError("URL 不能为空")
    try:
        parsed = urlsplit(value.strip())
        hostname = (parsed.hostname or "").rstrip(".").lower()
        port = parsed.port
    except ValueError:
        raise AnySearchError("URL 格式无效") from None
    if parsed.scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password:
        raise AnySearchError("仅允许无内嵌凭据的公开 HTTP(S) URL")
    if port is not None and not 1 <= port <= 65535:
        raise AnySearchError("URL 端口无效")
    if hostname in {"localhost", "local"} or hostname.endswith(
        (".localhost", ".local", ".internal", ".home", ".lan")
    ):
        raise AnySearchError("不允许本地或私有网络 URL")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        try:
            ascii_host = hostname.encode("idna").decode("ascii")
        except UnicodeError:
            raise AnySearchError("URL 主机名无效") from None
        # 127.1 等非标准缩写也可能被下游解析成回环 IP。
        if re.fullmatch(r"[0-9.]+", ascii_host):
            raise AnySearchError("不允许本地或私有网络 URL")
        if "." not in ascii_host or not re.fullmatch(r"[a-z0-9.-]+", ascii_host):
            raise AnySearchError("URL 主机名无效") from None
    else:
        if not address.is_global:
            raise AnySearchError("不允许本地或私有网络 URL")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.query, ""))


def request_api(method: str, path: str, payload: dict | None = None, domains: list[str] | None = None, opener=urlopen) -> dict:
    if path not in {"/v1/search", "/v1/extract", "/v1/domains", "/v1/sub-domains"}:
        raise AnySearchError("不支持的 AnySearch 接口")
    url = API_ORIGIN + path
    if domains:
        url += "?" + urlencode([("domain", domain) for domain in domains])
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json", "X-Anysearch-Client": CLIENT_ID}
    if body is not None:
        headers["Content-Type"] = "application/json"
    key = os.environ.get("ANYSEARCH_API_KEY", "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        raise AnySearchError(f"AnySearch 返回 HTTP {exc.code}") from None
    except (URLError, TimeoutError, OSError):
        raise AnySearchError("AnySearch 网络请求失败或超时") from None
    if len(raw) > MAX_RESPONSE_BYTES:
        raise AnySearchError("AnySearch 响应超过大小限制")
    try:
        envelope = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise AnySearchError("AnySearch 返回无效 JSON") from None
    if not isinstance(envelope, dict):
        raise AnySearchError("AnySearch 响应格式无效")
    code = envelope.get("code")
    if type(code) is not int or code != 0:
        # 不回显服务端 message；它可能重复包含用户查询或其他敏感内容。
        safe_code = str(code) if type(code) is int else "格式无效"
        raise AnySearchError(f"AnySearch 业务错误：{safe_code}")
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise AnySearchError("AnySearch 响应缺少 data 对象")
    if path == "/v1/search" and (
        not isinstance(data.get("results"), list)
        or not all(isinstance(item, dict) for item in data["results"])
    ):
        raise AnySearchError("AnySearch 搜索结果格式无效")
    if path == "/v1/extract" and not isinstance(data.get("content"), str):
        raise AnySearchError("AnySearch 网页正文格式无效")
    return envelope


def validate_search(value: dict) -> dict:
    if not isinstance(value, dict) or set(value) - SEARCH_FIELDS:
        raise AnySearchError("搜索字段无效")
    query = value.get("query")
    if not isinstance(query, str) or not 0 < len(query.strip()) <= 2000:
        raise AnySearchError("query 须为 1–2000 字符")
    result = {"query": query.strip()}
    count = value.get("max_results", 5)
    if type(count) is not int or not 1 <= count <= 10:
        raise AnySearchError("max_results 须为 1–10 的整数")
    result["max_results"] = count
    tag = value.get("tag")
    if tag is not None:
        if not isinstance(tag, str) or not re.fullmatch(r"[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*", tag):
            raise AnySearchError("tag 须为目录中的 domain.sub_domain")
        result["tag"] = tag
    params = value.get("params")
    if params is not None:
        if tag is None or not isinstance(params, dict) or not all(isinstance(key, str) for key in params):
            raise AnySearchError("params 须与 tag 同用，且为 JSON 对象")
        result["params"] = params
    zone = value.get("zone")
    if zone is not None:
        if zone not in {"cn", "intl"}:
            raise AnySearchError("zone 仅支持 cn 或 intl")
        result["zone"] = zone
    language = value.get("language")
    if language is not None:
        if not isinstance(language, str) or not re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*", language):
            raise AnySearchError("language 格式无效")
        result["language"] = language
    return result


def search(value: dict, requester=request_api) -> dict:
    return requester("POST", "/v1/search", validate_search(value))


def batch_search(values: list[dict], requester=request_api) -> list[dict]:
    if not isinstance(values, list) or not 1 <= len(values) <= 5:
        raise AnySearchError("批量搜索须包含 1–5 个查询")
    validated = [validate_search(value) for value in values]

    def run(value: dict) -> dict:
        try:
            return {"ok": True, "response": requester("POST", "/v1/search", value)}
        except AnySearchError as exc:
            return {"ok": False, "error": str(exc)}

    with ThreadPoolExecutor(max_workers=len(validated)) as pool:
        return list(pool.map(run, validated))


def cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="在 Proma 中调用 AnySearch")
    commands = parser.add_subparsers(dest="command", required=True)
    single = commands.add_parser("search", help="通用或垂直搜索")
    single.add_argument("query")
    single.add_argument("--tag", help="先查看目录，例如 academic.search")
    single.add_argument("--params", help="该子领域的 JSON 参数对象")
    single.add_argument("--zone", choices=["cn", "intl"])
    single.add_argument("--language")
    single.add_argument("--max-results", type=int, default=5)
    commands.add_parser("domains", help="列出当前搜索领域")
    sub = commands.add_parser("subdomains", help="发现子领域和参数约束")
    sub.add_argument("domain", nargs="+", help="一次最多五个领域")
    batch = commands.add_parser("batch", help="并行执行 1–5 个独立查询")
    batch.add_argument("queries", help="JSON 搜索对象数组")
    extract = commands.add_parser("extract", help="提取公开网页正文")
    extract.add_argument("url")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = cli_parser().parse_args(argv)
    try:
        if args.command == "search":
            value = {"query": args.query, "max_results": args.max_results}
            for name in ("tag", "zone", "language"):
                if getattr(args, name) is not None:
                    value[name] = getattr(args, name)
            if args.params is not None:
                value["params"] = json.loads(args.params)
            result = search(value)
        elif args.command == "domains":
            result = request_api("GET", "/v1/domains")
        elif args.command == "subdomains":
            if not 1 <= len(args.domain) <= 5 or not all(re.fullmatch(r"[a-z][a-z0-9_]*", item) for item in args.domain):
                raise AnySearchError("须提供 1–5 个有效领域标识")
            result = request_api("GET", "/v1/sub-domains", domains=args.domain)
        elif args.command == "batch":
            result = batch_search(json.loads(args.queries))
        else:
            result = request_api("POST", "/v1/extract", {"url": public_url(args.url)})
    except (AnySearchError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
