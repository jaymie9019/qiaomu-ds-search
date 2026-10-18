"""General-purpose, caller-planned research contracts (no model API fixtures)."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import ds_search as ds


def row(url, text, title='Source'):
    return dict(url=url, title=title, snippet=text, summary=text, content=text)


class AgentWorkflowTests(unittest.TestCase):
    def test_default_does_not_guess_a_person_filter_or_truth_verdict(self):
        r = row('https://example.com/a', '竇唯 biography', '采访与婚姻')
        out = ds.process_results([r], '窦唯的简历')
        self.assertEqual(len(out['results']), 1)
        self.assertEqual(out['quality']['profile'], 'generic')
        self.assertFalse(out['facts_verified'])

    def test_only_caller_queries_execute_even_after_three_sources(self):
        rows = [row(f'https://{n}.example/a', str(n)) for n in range(3)]
        with patch.object(ds, 'request_api', return_value=({'results': rows}, 1)) as api:
            out = ds.research('What is X?', 'fixture', queries=['X limitations', 'X first party examples'])
        self.assertEqual([c.args[1]['query'] for c in api.call_args_list],
                         ['What is X?', 'X limitations', 'X first party examples'])
        self.assertEqual(out['planning']['owner'], 'calling_agent')
        self.assertFalse(out['planning']['automatic_query_expansion'])
        self.assertEqual(out['budget']['used'], 3)

    def test_bare_keyword_does_not_trigger_hidden_expansion(self):
        with patch.object(ds, 'request_api', return_value=({'results': []}, 1)) as api:
            out = ds.research('苹果', 'fixture')
        self.assertEqual(api.call_count, 1)
        self.assertEqual(out['planning']['stop_reason'], 'plan_completed')

    def test_all_queries_validated_before_any_paid_request(self):
        with patch.object(ds, 'request_api') as api:
            for query_list, budget in [(['x' * 129], 8), (['b', 'c'], 2)]:
                with self.assertRaises(ds.SearchError):
                    ds.research('a', 'fixture', queries=query_list, max_searches=budget)
        api.assert_not_called()

    def test_duplicate_queries_do_not_consume_budget_twice(self):
        with patch.object(ds, 'request_api', return_value=({'results': []}, 1)) as api:
            out = ds.research('a', 'fixture', queries=['a', ' b ', 'b'], max_searches=2)
        self.assertEqual(api.call_count, 2)
        self.assertEqual(out['planning']['planned_queries'], ['a', 'b'])

    def test_partial_failure_exposes_remaining_plan_and_spent_budget(self):
        with patch.object(ds, 'request_api', side_effect=[({'results': [row('https://a.example', 'A')]}, 1),
                                                        ds.SearchError('failed', 'network_error')]):
            out = ds.research('a', 'fixture', queries=['b', 'c'])
        self.assertFalse(out['complete'])
        self.assertEqual(out['planning']['remaining_queries'], ['b', 'c'])
        self.assertEqual(out['budget']['used'], 2)

    def test_generic_duplicate_keeps_changed_numeric_and_text_evidence(self):
        a = row('https://example.com/a', 'v2 supports 12 requests; released worldwide.')
        b = row('https://example.com/a?utm_source=x', 'v2 supports 8 requests; limited preview.')
        out = ds.process_results([a, b], 'product limits')
        self.assertEqual(len(out['results']), 1)
        self.assertEqual(out['results'][0]['alternates'][0]['variant']['content'], b['content'])

    def test_merge_is_offline_and_preserves_changed_variants(self):
        a = {'results': [row('https://example.com/a', 'API limit 12')]}
        b = {'results': [row('https://example.com/a?utm_source=x', 'API limit 8')]}
        merged = ds.merge_outputs([a, b], 'API limits')
        again = ds.merge_outputs([merged], 'API limits')
        self.assertEqual(again['results'][0]['alternates'][0]['variant']['content'], 'API limit 8')
        self.assertEqual(again['quality']['duplicate_count'], 1)

    def test_merge_cli_needs_no_credentials_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'results.json'
            p.write_text(json.dumps({'results': [row('https://example.com/a', 'A')]}))
            output = io.StringIO()
            with patch.object(ds, 'load_key') as key, patch.object(ds, 'request_api') as api, contextlib.redirect_stdout(output):
                code = ds.main(['merge', 'topic', str(p)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())['operation'], 'merge')
        key.assert_not_called()
        api.assert_not_called()

    def test_repeated_merge_does_not_hide_upstream_failure(self):
        partial = {'results': [row('https://example.com/a', 'A')], 'ok': False, 'complete': False,
                   'errors': [{'code': 'network_error'}]}
        merged = ds.merge_outputs([partial], 'topic')
        self.assertFalse(ds.merge_outputs([merged], 'topic')['upstream_complete'])

    def test_cli_passes_expansions_without_overwriting_original(self):
        with patch.object(ds, 'load_key', return_value=('fixture', 'test')), \
                patch.object(ds, 'request_api', return_value=({'results': []}, 1)) as api, \
                contextlib.redirect_stdout(io.StringIO()):
            code = ds.main(['research', 'original', '--query', 'expanded', '--max-searches', '2'])
        self.assertEqual(code, 0)
        self.assertEqual([c.args[1]['query'] for c in api.call_args_list], ['original', 'expanded'])

    def test_bad_merge_input_is_reported_without_reading_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'bad.json'
            p.write_text('not-json')
            error = io.StringIO()
            with patch.object(ds, 'load_key') as key, contextlib.redirect_stderr(error):
                code = ds.main(['merge', 'topic', str(p)])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(error.getvalue())['error']['code'], 'invalid_input')
        key.assert_not_called()

    def test_malformed_query_metadata_is_rejected_before_merge(self):
        bad = row('https://example.com/a', 'A')
        bad['matched_queries'] = 'wrong-type'
        with self.assertRaises(ds.SearchError):
            ds.merge_outputs([{'results': [bad]}], 'topic')

    def test_queries_are_preserved_as_data(self):
        query = 'x; $(echo unsafe) `echo unsafe`'
        with patch.object(ds, 'request_api', return_value=({'results': []}, 1)) as api:
            ds.research('topic', 'fixture', queries=[query])
        self.assertEqual(api.call_args_list[1].args[1]['query'], query)


if __name__ == '__main__':
    unittest.main()
