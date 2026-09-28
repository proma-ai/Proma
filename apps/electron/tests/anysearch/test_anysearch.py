"""AnySearch Skill 的协议、匿名安全和并行失败边界测试。"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "default-skills" / "anysearch" / "scripts" / "anysearch.py"
spec = importlib.util.spec_from_file_location("proma_anysearch", SCRIPT)
assert spec and spec.loader
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class FakeResponse:
    def __init__(self, value: object):
        self.content = json.dumps(value).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, _limit: int) -> bytes:
        return self.content


class AnySearchSkillBehavior(unittest.TestCase):
    def test_given_no_key_when_searching_then_anonymous_request_maps_query_and_count(self):
        observed = []

        def opener(request, timeout):
            observed.append((request, timeout))
            return FakeResponse({"code": 0, "data": {"results": []}})

        with patch.dict(os.environ, {}, clear=True):
            response = client.request_api("POST", "/v1/search", client.validate_search({"query": "  Proma  ", "max_results": 2}), opener=opener)

        self.assertEqual(response["data"]["results"], [])
        request, timeout = observed[0]
        self.assertEqual(request.full_url, "https://api.anysearch.com/v1/search")
        self.assertEqual(json.loads(request.data), {"query": "Proma", "max_results": 2})
        self.assertNotIn("Authorization", request.headers)
        self.assertEqual(request.get_header("X-anysearch-client"), client.CLIENT_ID)
        self.assertEqual(timeout, client.TIMEOUT_SECONDS)

    def test_given_configured_key_when_searching_then_bearer_is_sent_only_in_header(self):
        observed = []

        def opener(request, timeout):
            observed.append(request)
            return FakeResponse({"code": 0, "data": {"results": []}})

        with patch.dict(os.environ, {"ANYSEARCH_API_KEY": " secret-token "}, clear=True):
            client.request_api("POST", "/v1/search", {"query": "public search"}, opener=opener)

        request = observed[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer secret-token")
        self.assertNotIn("secret-token", request.full_url)
        self.assertNotIn(b"secret-token", request.data)

    def test_given_http_success_with_business_failure_then_it_is_not_empty_results(self):
        def opener(request, timeout):
            return FakeResponse({"code": 42901, "message": "query echoed: private", "data": {"results": []}})

        with self.assertRaisesRegex(client.AnySearchError, "42901") as raised:
            client.request_api("POST", "/v1/search", {"query": "private"}, opener=opener)
        self.assertNotIn("private", str(raised.exception))

    def test_given_malformed_success_then_it_is_not_presented_as_empty_search(self):
        def opener(request, timeout):
            return FakeResponse({"code": 0, "data": {"results": "not-a-list"}})

        with self.assertRaisesRegex(client.AnySearchError, "格式无效"):
            client.request_api("POST", "/v1/search", {"query": "public"}, opener=opener)

        def untrusted_code_opener(request, timeout):
            return FakeResponse({"code": "private-query-echo", "data": {"results": []}})

        with self.assertRaises(client.AnySearchError) as raised:
            client.request_api("POST", "/v1/search", {"query": "private"}, opener=untrusted_code_opener)
        self.assertNotIn("private", str(raised.exception))

    def test_given_vertical_search_when_validating_then_tag_and_params_are_preserved(self):
        value = client.validate_search({"query": "AAPL", "tag": "finance.quote", "params": {"type": "stock", "symbol": "AAPL", "cn_code": ""}, "max_results": 1})
        self.assertEqual(value["tag"], "finance.quote")
        self.assertEqual(value["params"]["cn_code"], "")
        with self.assertRaises(client.AnySearchError):
            client.validate_search({"query": "AAPL", "params": {"symbol": "AAPL"}})

    def test_given_parallel_queries_when_one_fails_then_other_result_and_order_survive(self):
        def requester(method, path, payload):
            if payload["query"] == "bad":
                raise client.AnySearchError("rate limited")
            return {"code": 0, "data": {"results": [{"title": payload["query"]}]}}

        result = client.batch_search([{"query": "first"}, {"query": "bad"}, {"query": "last"}], requester=requester)
        self.assertEqual([item["ok"] for item in result], [True, False, True])
        self.assertEqual(result[0]["response"]["data"]["results"][0]["title"], "first")
        self.assertEqual(result[2]["response"]["data"]["results"][0]["title"], "last")

    def test_given_private_or_credentialed_url_then_extract_refuses_it(self):
        for url in ("http://127.0.0.1/admin", "http://127.1/admin", "http://[::1]/", "https://user:pass@example.com/", "file:///etc/passwd", "http://service.local/"):
            with self.subTest(url=url), self.assertRaises(client.AnySearchError):
                client.public_url(url)
        self.assertEqual(client.public_url("https://example.com/page#section"), "https://example.com/page")
        self.assertEqual(client.public_url("https://例子.测试/页面"), "https://例子.测试/页面")


if __name__ == "__main__":
    unittest.main()
