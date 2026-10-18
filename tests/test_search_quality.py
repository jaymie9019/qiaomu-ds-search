"""Regression cases from the Dou Wei run plus unrelated boundary cases."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import ds_search as ds


def row(url, title, text, authority=3):
    return {"url": url, "title": title, "summary": text, "snippet": text[:100],
            "content": text, "date": None, "authority": authority, "rerank_score": 2.0}


class QualityTests(unittest.TestCase):
    def review(self, rows, query="窦唯的简历", **kwargs):
        kwargs.setdefault("profile", "auto")
        return ds.process_results(rows, query, **kwargs)

    def test_observed_duplicate_and_gossip_failure(self):
        rows = [
            row("https://baike.baidu.com/item/窦唯/156394#1", "窦唯", "1989年，窦唯加入黑豹乐队。"),
            row("https://baike.baidu.com/item/竇唯/156394?bst=123", "窦唯", "1989年，窦唯加入黑豹乐队。"),
            row("https://wapbaike.baidu.com/item/窦唯/156394?uid=123", "窦唯", "1989年，窦唯加入黑豹乐队。"),
            row("https://example.com/gossip", "王菲前夫窦唯近况曝光 两人为何离婚", "窦唯，1988年加入黑豹乐队。",4),
        ]
        out = self.review(rows)
        self.assertEqual(len(out["results"]), 1)
        self.assertEqual(out["quality"]["duplicate_count"], 2)
        self.assertEqual(out["quality"]["excluded_count"], 1)
        self.assertEqual(out["quality"]["profile"], "biography")

    def test_tracking_removed_but_meaningful_parameters_preserved(self):
        rows = [row("https://example.com/a?id=1&utm_source=x#top", "文档", "A"),
                row("https://example.com/a?id=1", "文档", "A"),
                row("https://example.com/a?id=2", "文档", "B")]
        self.assertEqual(len(self.review(rows, "文档")["results"]), 2)

    def test_wiki_mirror_is_same_origin(self):
        rows = [row("https://zh.wikipedia.org/wiki/窦唯", "窦唯", "1988年，窦唯加入黑豹乐队。"),
                row("https://www.wikiwand.com/zh-cn/窦唯#1", "窦唯", "1988年，窦唯加入黑豹乐队。")]
        out = self.review(rows)
        self.assertEqual(out["quality"]["source_family_count"], 1)
        self.assertEqual(len(out["results"]), 1)

    def test_copies_do_not_count_as_corroboration(self):
        text = "林青的音乐经历。" + "1988年，林青加入晨光乐队，担任主唱并创作歌曲。" * 6
        out = self.review([row("https://a.example/a", "林青", text),
                           row("https://b.example/b", "林青", text)], "林青的简历")
        self.assertEqual(len(out["results"]), 1)
        self.assertEqual(out["quality"]["source_family_count"], 1)

    def test_different_numbers_in_similar_pages_are_not_erased(self):
        text = "林青的音乐经历。" + "他学习音乐并持续创作，发行了多部作品。" * 12
        a = row("https://a.example/a", "林青", text + "1988年，林青加入晨光乐队。")
        b = row("https://b.example/b", "林青", text + "1989年，林青加入晨光乐队。")
        out = self.review([a,b], "林青的简历")
        self.assertEqual(len(out["results"]), 2)
        self.assertEqual(len(out["conflicts"]), 1)

    def test_changed_negation_and_reordered_years_are_not_near_copies(self):
        base = '林青的音乐经历。' + '他学习音乐并持续创作，发行了多部作品。' * 12
        pairs = [('1988年林青加入晨光乐队。', '1988年林青没加入晨光乐队。'),
                 ('1988年加入晨光乐队，1989年离开。', '1989年加入晨光乐队，1988年离开。')]
        for a, b in pairs:
            out = self.review([row('https://a.example/a','林青',base+a),row('https://b.example/b','林青',base+b)], '林青的简历')
            self.assertEqual(len(out['results']),2)

    def test_duplicate_versions_keep_conflicting_evidence(self):
        out = self.review([row("https://a.example/a", "窦唯", "1988年，窦唯加入黑豹乐队。"),
                           row("https://a.example/a?utm_source=x", "窦唯", "1989年，窦唯加入黑豹乐队。")])
        self.assertEqual(len(out["results"]), 1)
        self.assertEqual(out["conflicts"][0]["status"], "unresolved")
        self.assertEqual(set(out["conflicts"][0]["values"]), {"1988", "1989"})

    def test_subject_filter_does_not_keep_same_surname(self):
        out = self.review([row("https://example.com/a", "窦靖童简历", "窦靖童演艺经历")])
        self.assertEqual(out["results"], [])

    def test_alias_supports_translated_names(self):
        out = self.review([row("https://example.com/a", "Dou Wei biography", "Dou Wei is a musician.")], aliases=["Dou Wei"])
        self.assertEqual(len(out["results"]), 1)

    def test_gossip_filter_is_intent_scoped(self):
        record = row("https://example.com/a", "窦唯为何离婚", "窦唯个人生活")
        self.assertEqual(len(self.review([record], "窦唯为何离婚")["results"]), 1)
        interview = row("https://example.com/b", "窦唯访谈：婚姻与音乐生涯", "窦唯谈创作")
        self.assertEqual(len(self.review([interview])["results"]), 1)

    def test_score_never_decides_conflicting_year(self):
        rows = [row("https://a.example/a", "窦唯", "1988年，窦唯加入黑豹乐队。",4),
                row("https://b.example/b", "窦唯", "1989年，窦唯加入黑豹乐队。",1)]
        conflict = self.review(rows)["conflicts"][0]
        self.assertEqual(conflict["status"], "unresolved")
        self.assertTrue(conflict["verification_query"])
        self.assertTrue(all(e["evidence_level"] == "page_content" for e in conflict["evidence"]))

    def test_other_people_negation_and_different_events_not_conflated(self):
        records = [row("https://a.example/a", "窦唯", "1988年，李明加入黑豹乐队。1989年，窦唯并未加入黑豹乐队。"),
                   row("https://b.example/b", "窦唯", "1994年，窦唯发行《黑梦》。1995年，窦唯发行《艳阳天》。")]
        out = self.review(records)
        self.assertFalse(out["conflicts"])
        self.assertFalse(any(f["event"] == "加入黑豹乐队" for f in out["facts"]))

    def test_english_unknown_scope_does_not_claim_verified(self):
        out = self.review([row("https://example.com", "Product specs", "Weight is 20 kg, others say 25 kg.")], "product comparison")
        self.assertFalse(out["facts_verified"])
        self.assertIn("manual", out["quality"]["fact_check_scope"])

    def test_bad_urls_are_filtered_without_crash(self):
        out = self.review([row("javascript:alert(1)", "窦唯", "窦唯简历"),row("https://[oops", "窦唯", "窦唯简历")])
        self.assertEqual(len(out["results"]),0)

    def test_spa_routes_and_ordered_repeated_query_values_remain_distinct(self):
        urls = ['https://example.com/#/one','https://example.com/#/two',
                'https://example.com/?sort=a&sort=b','https://example.com/?sort=b&sort=a']
        out = self.review([row(u, 'docs', '') for u in urls], 'docs')
        self.assertEqual(len(out['results']), 4)

    def test_title_alone_does_not_deduplicate(self):
        out = self.review([row('https://a.example/a','窦唯','音乐生涯'),
                           row('https://b.example/b','窦唯','作品目录')])
        self.assertEqual(len(out['results']), 2)

    def test_summary_evidence_and_absence_of_conflict_are_not_verification(self):
        r = row('https://example.com/a','窦唯','1988年，窦唯加入黑豹乐队。')
        r['content'] = ''
        out = self.review([r])
        self.assertEqual(out['facts'][0]['status'], 'unverified')
        self.assertEqual(out['facts'][0]['evidence'][0]['evidence_level'], 'search_summary')
        self.assertFalse(out['facts_verified'])

    def test_mentions_do_not_change_the_event_subject(self):
        out = self.review([row('https://example.com/a', '窦唯', '1988年，窦唯介绍李明加入黑豹乐队。')])
        self.assertFalse(out['facts'])

    def test_year_of_signing_is_not_year_of_later_album_release(self):
        out = self.review([row('https://example.com/a','窦唯', '1993年，窦唯签约公司，先后推出了《黑梦》。1994年，窦唯发行《黑梦》。')])
        self.assertEqual(out['facts'][0]['values'], ['1994'])
        self.assertFalse(out['conflicts'])

    def test_clickbait_and_gossip_index_are_filtered_only_in_biography(self):
        rows = [row('https://example.com/a', '窦唯新闻_窦唯八卦', '窦唯生平'),
                row('https://example.com/b', '采访说窦唯一唱歌分分钟都是钱', '窦唯')]
        self.assertFalse(self.review(rows)['results'])
        self.assertEqual(len(self.review(rows, '窦唯的新闻')['results']), 2)


class ResearchTests(unittest.TestCase):
    def test_explicit_biography_adapter_retains_conflicts_without_resolving(self):
        a = row('https://a.example/a', '窦唯', '1988年，窦唯加入黑豹乐队。')
        b = row('https://b.example/b', '窦唯', '1989年，窦唯加入黑豹乐队。')
        with patch.object(ds, 'request_api', side_effect=[({'results':[a]},1), ({'results':[b]},1), ({'results':[a]},1)]) as call:
            out = ds.research('窦唯的简历', 'unit-test-key', profile='biography',
                              queries=['窦唯主要经历', '窦唯加入黑豹乐队时间采访'])
        self.assertEqual(call.call_count, 3)
        self.assertEqual(out['conflicts'][0]['status'], 'unresolved')
        self.assertFalse(out['facts_verified'])
        self.assertTrue(out['complete'])

    def test_partial_failure_keeps_evidence_and_reports_incomplete(self):
        a = row('https://a.example/a','窦唯','音乐生涯')
        with patch.object(ds,'request_api',side_effect=[({'results':[a]},1),ds.SearchError('network','network_error')]):
            out = ds.research('窦唯的简历', 'unit-test-key', queries=['窦唯作品'])
        self.assertFalse(out['ok'])
        self.assertFalse(out['complete'])
        self.assertEqual(len(out['results']),1)
        self.assertEqual(out['errors'][0]['code'],'network_error')

    def test_executes_single_query_when_only_one_was_supplied(self):
        rows = [row(f'https://{n}.example/a','doc',str(n)) for n in range(3)]
        with patch.object(ds,'request_api',return_value=({'results':rows},1)) as call:
            ds.research('docs','unit-test-key')
        self.assertEqual(call.call_count,1)
        with patch.object(ds,'request_api',return_value=({'results':rows[:1]},1)) as call:
            ds.research('docs','unit-test-key',max_searches=1)
        self.assertEqual(call.call_count,1)

    def test_long_query_never_silently_truncates_or_repeats(self):
        a = row('https://a.example/a','doc','doc')
        with patch.object(ds,'request_api',return_value=({'results':[a]},1)) as call:
            out = ds.research('字'*128,'unit-test-key')
        self.assertEqual(call.call_count,1)
        self.assertEqual(out['searches'][0]['query'],'字'*128)

    def test_invalid_options_do_not_send_paid_requests(self):
        with patch.object(ds,'request_api') as call:
            for limit in (0, 9, True):
                with self.assertRaises(ds.SearchError):
                    ds.research('docs','unit-test-key',max_searches=limit)
        call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
