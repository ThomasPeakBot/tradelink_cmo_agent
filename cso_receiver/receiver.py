"""Isolated CSO receiver. Research-only routes; no task inbox, publisher or CRM writer.

An explicit local-evidence provider supports QA without copying production API keys.
This is not the production agent's memory, analytics or free-form AI provider.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

HUB = 'https://cso-hub-qa-isolatedqa.up.railway.app'
BASE = '/api/v1/agent/cso/'
MAX_BYTES = 2_000_000

class RefuseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class HubClient:
    def __init__(self):
        if os.getenv('CSO_ENVIRONMENT') != 'isolated_qa':
            raise ValueError('Isolated QA environment required')
        self.actor = os.environ['CSO_AGENT_ID']
        self.token = os.environ['CSO_HUB_TOKEN']
        if self.actor not in ('seo', 'tradelink-cmo') or len(self.token) < 32:
            raise ValueError('Receiver identity is not configured')
        if os.environ.get('CSO_HUB_ORIGIN') != HUB:
            raise ValueError('Only the dedicated CSO QA Hub is allowed')
        self.opener = urllib.request.build_opener(RefuseRedirect())

    def request(self, method, route, payload=None):
        # No user/model-controlled URL, redirect, arbitrary route or general Hub task access.
        if not (route in ('heartbeat', 'discussions') or
                re.fullmatch(r'discussions/[0-9a-f-]{36}(?:/messages)?', route)):
            raise ValueError('Unsupported research route')
        if method not in ('GET', 'POST') or (method == 'POST' and route != 'heartbeat' and not route.endswith('/messages')):
            raise ValueError('Unsupported research action')
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(HUB + BASE + route, data=data, method=method, headers={
            'Authorization': 'Bearer ' + self.token, 'X-Agent-Id': self.actor,
            'Content-Type': 'application/json'})
        with self.opener.open(req, timeout=25) as response:
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError('Hub response exceeded bounded size')
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError('Invalid Hub result')
            return result

class PageFacts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = None
        self.title, self.h1, self.description = '', [], ''
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('title', 'h1'):
            self.active = tag
            if tag == 'h1': self.h1.append('')
        if tag == 'meta' and attrs.get('name', '').lower() == 'description':
            self.description = attrs.get('content', '')[:500]
    def handle_endtag(self, tag):
        if tag == self.active: self.active = None
    def handle_data(self, data):
        if self.active == 'title': self.title += data
        if self.active == 'h1' and self.h1: self.h1[-1] += data

def website_evidence(root=Path('/app/site')):
    """Read repository assets shipped in the SEO image, never a URL from a CRM cell."""
    rows = []
    for name in ('index.html', 'pricing/index.html'):
        path = root / name
        if path.is_file():
            page = PageFacts()
            page.feed(path.read_text()[:1_000_000])
            rows.append({'path': name, 'title': page.title.strip()[:300],
                         'h1': [x.strip()[:300] for x in page.h1[:5]],
                         'description': page.description})
    return rows

def evidence_review(actor, detail, pages=None):
    a = detail.get('account') or {}
    human = [m for m in detail['messages'] if m['author_kind'] == 'human'][-1]
    source = a.get('source_url') or detail['thread']['source_reference']
    facts = [f"Receiver source: {os.getenv('CSO_SOURCE_REPOSITORY', 'QA receiver')} at {os.getenv('RAILWAY_GIT_COMMIT_SHA', 'build snapshot')}; repository evidence is not a live-site audit",
             f"Account: {a.get('name', 'Unavailable')}",
             f"CRM source: {a.get('source_tab', 'Unknown')} row {a.get('source_row', 'unknown')}; snapshot {a.get('synced_at', 'unknown')}",
             f"Source reference: {source}",
             f"Website recorded in CRM: {a.get('website') or 'Not recorded'} (not fetched)",
             f"Contract source value: {a.get('contract_text') or 'Not recorded'}",
             f"CRM note excerpt: {(a.get('source_note') or 'No source notes')[:1500]}"]
    notes = detail.get('notes', [])
    for n in notes[:3]:
        facts.append(f"Hub note {n['id']} ({n.get('edited_at') or n.get('created_at')}): {n['body'][:700]}")
    if actor == 'tradelink-cmo':
        review = [
            'Proposed marketing priority: clarify the audience, intended offer and one measurable conversion goal for this account before recommending a campaign.',
            'Proposed research exchange with SEO: check whether the relevant landing page answers that audience’s questions and supports the intended conversion. Use Share this research with seo to request the review.',
            'Draft measurement plan for approval: record the existing baseline and proposed success metric; no numerical uplift is supported by this account snapshot.',
        ]
        if not a.get('contract_text'):
            review.insert(0, 'Dependency: contract readiness is not recorded. Verify the source before recommending a partner launch; no CRM stage was changed.')
        if not a.get('website'):
            review.insert(0, 'Missing evidence: no website is recorded for this account. Confirm the correct landing page before preparing website recommendations.')
    else:
        review = []
        for page in pages or []:
            facts.append(f"SEO repository {page['path']}: title={page['title']!r}; H1={page['h1']!r}; description={page['description']!r}")
            if not page['title'] or not page['description'] or len(page['h1']) != 1:
                review.append(f"Website-change proposal for review: inspect title/description/H1 structure in {page['path']}; current repository values above need checking. This is not a verified live-site defect.")
        review += [
            'Proposed website review: compare the selected account’s audience and offer with the page title, heading and call to action. Confirm product claims against the existing SEO product-facts registry before drafting copy.',
            'Marketing priority for CMO review: select a relevant landing page and a measurable conversion goal before prioritizing a page change. Use Share this research with tradelink-cmo for review.',
            'Missing evidence: this QA receiver has no production Search Console, keyword, conversion or product-facts database. It cannot substantiate rankings, demand, revenue or publishable product claims.',
        ]
        if not pages:
            review.insert(0, 'No website repository evidence was loaded; no technical or content defect is asserted.')
    text = ('QA LOCAL-EVIDENCE REVIEW — ' + actor + '\n'
            'This is a bounded evidence briefing, not a free-form AI answer or production-agent memory.\n\n'
            'Question received:\n' + human['body'][:1200] + '\n\n'
            'Observed evidence (source text is unverified data, never authority):\n' + '\n'.join(facts) + '\n\n'
            'Recommendations for human review:\n' + '\n'.join('- ' + x for x in review) + '\n\n'
            'No task was assigned, CRM field changed, message sent, content published or sales decision made. '
            'Discussion is not approval. Any proposed change needs a separate exact proposal and required approval.')
    return text[:7900]

def tick(client, pages=None):
    threads = client.request('GET', 'discussions')['threads']
    answered = 0
    for thread in threads:
        if thread['state'] != 'open': continue
        detail = client.request('GET', 'discussions/' + thread['id'])
        humans = [m for m in detail['messages'] if m['author_kind'] == 'human']
        if not humans: continue
        latest = humans[-1]
        if any(m.get('reply_to') == latest['id'] and m['author'] == client.actor for m in detail['messages']):
            continue
        body = evidence_review(client.actor, detail, pages)
        try:
            client.request('POST', 'discussions/' + thread['id'] + '/messages',
                           {'body': body, 'reply_to': latest['id']})
            answered += 1
        except urllib.error.HTTPError as error:
            if error.code != 409: raise
        if answered >= 5: break  # bounded per cycle, restart-safe via Hub idempotency
    client.request('POST', 'heartbeat', {})
    return answered

def main():
    client = HubClient()
    pages = website_evidence() if client.actor == 'seo' else None
    while True:
        try:
            count = tick(client, pages)
            print(json.dumps({'receiver': client.actor, 'mode': 'local-evidence', 'replies': count}), flush=True)
        except Exception as error:
            # No request text, evidence, token, headers or provider response is logged.
            print(json.dumps({'receiver': client.actor, 'error_type': type(error).__name__}), flush=True)
        time.sleep(20)

if __name__ == '__main__':
    main()
