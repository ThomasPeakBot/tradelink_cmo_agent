import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from receiver import HubClient, HUB, evidence_review, tick, website_evidence

class Client:
    actor = 'seo'
    def __init__(self):
        self.posts = []
        self.detail = {'thread': {'source_reference':'CRM / QA fixture'},
                       'account': {'name':'QA fixture'}, 'notes':[],
                       'messages':[{'id':'human-1','author':'test','author_kind':'human','body':'Review only'}]}
    def request(self, method, route, payload=None):
        if route == 'heartbeat': return {'accepted': True}
        if route == 'discussions': return {'threads':[{'id':'a'*36,'state':'open'}]}
        if route.endswith('/messages'):
            self.posts.append(payload)
            self.detail['messages'].append({'id':'agent-1','author':'seo','author_kind':'agent',**payload})
            return {'stored':True}
        return self.detail

class ReceiverTests(unittest.TestCase):
    def test_idempotent_across_ticks(self):
        c=Client()
        self.assertEqual(tick(c),1)
        self.assertEqual(tick(c),0)
        self.assertEqual(len(c.posts),1)
        self.assertEqual(c.posts[0]['reply_to'],'human-1')
    def test_new_question_gets_reply(self):
        c=Client();tick(c)
        c.detail['messages'].append({'id':'human-2','author':'test','author_kind':'human','body':'Follow-up'})
        self.assertEqual(tick(c),1)
    def test_source_text_cannot_control_routes(self):
        with patch.dict(os.environ,{'CSO_ENVIRONMENT':'isolated_qa','CSO_AGENT_ID':'seo','CSO_HUB_TOKEN':'x'*40,'CSO_HUB_ORIGIN':HUB}):
            c=HubClient()
            for route in ('../../tasks','proposals','discussions/https://evil.test','https://evil.test'):
                with self.assertRaises(ValueError):c.request('POST',route,{})
            with self.assertRaises(ValueError):c.request('DELETE','discussions',{})
    def test_production_origin_refused(self):
        with patch.dict(os.environ,{'CSO_ENVIRONMENT':'isolated_qa','CSO_AGENT_ID':'seo','CSO_HUB_TOKEN':'x'*40,'CSO_HUB_ORIGIN':'https://production.example'}):
            with self.assertRaises(ValueError):HubClient()
    def test_evidence_is_honestly_labeled(self):
        d=Client().detail
        for actor in ('seo','tradelink-cmo'):
            result=evidence_review(actor,d)
            self.assertIn('not a free-form AI answer',result)
            self.assertIn('No task was assigned',result)
            self.assertLessEqual(len(result),8000)
    def test_repository_html_observation(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'index.html').write_text('<title>QA</title><h1>Heading</h1><meta name="description" content="Description">')
            facts=website_evidence(Path(d))
            self.assertEqual(facts[0]['title'],'QA')
            self.assertEqual(facts[0]['h1'],['Heading'])
            self.assertEqual(facts[0]['description'],'Description')
    def test_no_invented_site_defect(self):
        result=evidence_review('seo',Client().detail,[])
        self.assertIn('no technical or content defect is asserted',result)

if __name__=='__main__':unittest.main()
