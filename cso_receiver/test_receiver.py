import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from receiver import HubClient, HUB, evidence_review, tick, website_evidence, model_settings, model_review
from unittest.mock import MagicMock

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
    def test_model_requires_explicit_enable_and_credentials(self):
        with patch.dict(os.environ,{},clear=True):
            self.assertIsNone(model_settings('seo'))
        with patch.dict(os.environ,{'CSO_RESEARCH_PROVIDER':'anthropic'},clear=True):
            with self.assertRaises(ValueError): model_settings('seo')
        with patch.dict(os.environ,{'CSO_RESEARCH_PROVIDER':'anthropic','CSO_MODEL_ENABLED':'true','CSO_RESEARCH_MODEL':'test','ANTHROPIC_API_KEY':'test-key'},clear=True):
            self.assertEqual(model_settings('seo')[0],'anthropic')
            with self.assertRaises(ValueError):model_settings('tradelink-cmo')
    def test_model_requests_are_toolless_and_bounded(self):
        for actor,provider,result in [('tradelink-cmo','openai',{'choices':[{'message':{'content':'Review only'}}]}),('seo','anthropic',{'content':[{'type':'text','text':'Review only'}]})]:
            opener=MagicMock()
            opener.open.return_value.__enter__.return_value.read.return_value=json.dumps(result).encode()
            with patch('receiver.urllib.request.build_opener',return_value=opener):
                answer=model_review(actor,Client().detail,[],(provider,'test-key','test-model'))
            request=opener.open.call_args.args[0]
            packet=json.loads(request.data)
            self.assertNotIn('tools',packet)
            self.assertEqual(packet.get('max_tokens',packet.get('max_completion_tokens')),1200)
            self.assertIn('QA MODEL REVIEW',answer)
            self.assertNotIn('test-key',answer)
    def test_model_claim_denial_never_calls_provider(self):
        c=Client();original=c.request
        def request(method,route,payload=None):
            if route.endswith('/model-claim'):return {'granted':False,'reason':'daily_limit'}
            return original(method,route,payload)
        c.request=request
        with patch('receiver.model_settings',return_value=('anthropic','test','model')),patch('receiver.model_review') as model:
            tick(c)
            model.assert_not_called()
        self.assertIn('daily_limit',c.posts[0]['body'])
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
