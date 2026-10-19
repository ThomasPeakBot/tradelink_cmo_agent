import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewMediaAsset } from '../lib/media-review';
const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const asset = {
  fileId: 'fixture_file',
  name: 'Fixture',
  path: 'TradeLink/sub/Fixture',
  mimeType: 'image/png',
  modifiedAt: '2026-10-19T12:00:00Z',
  parentId: 'fixture_folder',
  size: null,
};
const response = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Visible fixture reviewed',
              growthImplications: ['Test a clear CTA'],
              uncertainties: ['No performance measured'],
            }),
          },
        },
      ],
    }),
  );
it('visually reviews actual image bytes, enforces bounded structured output and labels Photoshop composites as partial', async () => {
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', 'fixture');
  const dir = await mkdtemp(join(tmpdir(), 'media-test-'));
  dirs.push(dir);
  await exec('convert', ['-size', '32x32', 'xc:green', join(dir, 'fixture.png')]);
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].content).toContain('untrusted DATA');
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.response_format.json_schema.schema.properties.summary.maxLength).toBe(3000);
    return response();
  });
  const result = await reviewMediaAsset(asset, await readFile(join(dir, 'fixture.png')), fetcher);
  expect(result.status).toBe('REVIEWED');
  expect(result.coverage).toContain('1600px');
  await exec('convert', ['-size', '32x32', 'xc:green', join(dir, 'fixture.psd')]);
  const psd = await reviewMediaAsset(
    { ...asset, mimeType: 'image/x-photoshop' },
    await readFile(join(dir, 'fixture.psd')),
    fetcher,
  );
  expect(psd.status).toBe('PARTIAL');
  expect(psd.coverage).toContain('Hidden layers');
}, 30000);
it('covers a video timeline with explicit sampling limits and never invents absent audio', async () => {
  vi.stubEnv('TRADELINK_OPENAI_API_KEY', 'fixture');
  const dir = await mkdtemp(join(tmpdir(), 'video-test-'));
  dirs.push(dir);
  await exec('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=64x64:r=4',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    '-an',
    join(dir, 'fixture.mp4'),
  ]);
  const fetcher = vi.fn(async () => response());
  const result = await reviewMediaAsset(
    { ...asset, mimeType: 'video/mp4' },
    await readFile(join(dir, 'fixture.mp4')),
    fetcher,
  );
  expect(result.status).toBe('PARTIAL');
  expect(result.coverage).toContain('sampled');
  expect(result.coverage).toContain('No audio stream');
  expect(fetcher).toHaveBeenCalledTimes(2);
}, 30000);
it('rejects mislabeled image/video bytes before invoking a parser or provider', async () => {
  const fetcher = vi.fn();
  await expect(reviewMediaAsset(asset, Buffer.from('<svg>not png</svg>'), fetcher)).rejects.toThrow(
    'signature',
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it('extracts hidden and visible workbook tabs, retains formulas and rejects entity declarations without executing anything', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbook-test-'));
  dirs.push(dir);
  const path = join(dir, 'fixture.xlsx');
  const script = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Visible" r:id="one"/><sheet name="Hidden" state="hidden" r:id="two"/></sheets></workbook>')\nz.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Target="worksheets/one.xml"/><Relationship Id="two" Target="worksheets/two.xml"/></Relationships>')\nfor n in ['one','two']: z.writestr('xl/worksheets/'+n+'.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>')\nz.close()`;
  await exec('/usr/bin/python3', ['-c', script, path]);
  const result = await exec('/usr/bin/python3', [
    join(process.cwd(), 'scripts/media/read-workbook.py'),
    path,
  ]);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.sheets).toHaveLength(2);
  expect(parsed.sheets[1].visibility).toBe('hidden');
  expect(parsed.sheets[1].rows[0][0]).toMatchObject({ value: '2', formula: '1+1' });
  await exec('/usr/bin/python3', [
    '-c',
    `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'a');z.writestr('xl/workbook.xml','<!DOCTYPE workbook [<!ENTITY x "unsafe">]><workbook/>');z.close()`,
    path,
  ]);
  await expect(
    exec('/usr/bin/python3', [join(process.cwd(), 'scripts/media/read-workbook.py'), path]),
  ).rejects.toThrow();
});
