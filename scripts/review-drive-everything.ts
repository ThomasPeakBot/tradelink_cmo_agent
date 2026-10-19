import 'dotenv/config';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { db } from '../lib/db';
import { syncDrive } from '../lib/drive-sync';
import { DriveReadError, tradeLinkFolderId } from '../lib/drive';
import { DriveAssetReader, driveInventorySchema } from '../lib/drive-assets';
import { reviewMediaAsset } from '../lib/media-review';
import { driveReviewSchema, reviewDriveDocument } from '../lib/drive-review';
const textMimes = new Set(['application/vnd.google-apps.document', 'text/plain', 'text/markdown']);
const reviewVersion = 'recursive-content-v1';
let stage = 'initialization';
async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const admin = await db.user.findFirstOrThrow({
    where: { role: 'ADMIN' },
    select: { id: true, email: true },
  });
  stage = 'inventory';
  try {
    await syncDrive(admin.email);
  } catch (error) {
    if (!(error instanceof DriveReadError && error.code === 'busy')) throw error;
  }
  const state = await db.driveSync.findUniqueOrThrow({ where: { folderId: tradeLinkFolderId } });
  const inventoryReport = await db.report.findUniqueOrThrow({
    where: { id: 'drive-file-inventory' },
  });
  const inventory = driveInventorySchema.parse(JSON.parse(inventoryReport.content));
  if (
    !state.active ||
    inventory.capturedAt !== state.syncedAt.toISOString() ||
    Date.now() - state.syncedAt.getTime() > 180000
  )
    throw Error('Fresh complete folder inventory required');
  const reader = await DriveAssetReader.create(inventory);
  const results: {
    fileId: string;
    name: string;
    path: string;
    mimeType: string;
    status: string;
    coverage: string;
    summary: string;
  }[] = [];
  console.log(
    'RECURSIVE_REVIEW_STARTED ' +
      JSON.stringify({
        folders: inventory.folders.length,
        files: inventory.files.length,
        types: inventory.files.reduce<Record<string, number>>((a, f) => {
          a[f.mimeType] = (a[f.mimeType] ?? 0) + 1;
          return a;
        }, {}),
      }),
  );
  for (const asset of inventory.files) {
    stage = `file-${results.length + 1}-of-${inventory.files.length}`;
    const memoryId = `${textMimes.has(asset.mimeType) ? 'drive-review:' : 'drive-asset-review:'}${asset.fileId}`;
    const previous = await db.memory.findUnique({ where: { id: memoryId } });
    let cached: Record<string, unknown> | null = null;
    try {
      cached = previous ? JSON.parse(previous.content) : null;
    } catch {}
    try {
      let result: {
        status: string;
        coverage: string;
        review: { summary: string; growthImplications: string[]; uncertainties: string[] };
      };
      if (
        cached?.reviewVersion === reviewVersion &&
        cached.modifiedAt === asset.modifiedAt &&
        ['REVIEWED', 'PARTIAL'].includes(String(cached.status))
      ) {
        result = {
          status: String(cached.status),
          coverage: String(cached.coverage),
          review: driveReviewSchema.parse({
            summary: cached.summary,
            growthImplications: cached.growthImplications,
            uncertainties: cached.uncertainties,
          }),
        };
      } else if (textMimes.has(asset.mimeType)) {
        const document = await db.driveDocument.findUniqueOrThrow({
          where: { folderId_fileId: { folderId: tradeLinkFolderId, fileId: asset.fileId } },
        });
        if (document.modifiedAt.getTime() !== Date.parse(asset.modifiedAt) || document.truncated)
          throw Error('Complete current text required');
        result = {
          status: 'REVIEWED',
          coverage: 'All imported text reviewed in full.',
          review: await reviewDriveDocument(document),
        };
      } else {
        const buffer = await reader.download(asset);
        result = await reviewMediaAsset(asset, buffer);
      }
      const source = {
        source: `https://drive.google.com/file/d/${asset.fileId}/view`,
        path: asset.path,
        mimeType: asset.mimeType,
        modifiedAt: asset.modifiedAt,
        syncedAt: inventory.capturedAt,
        reviewedAt: new Date().toISOString(),
        reviewVersion,
        status: result.status,
        coverage: result.coverage,
        ...result.review,
      };
      if (textMimes.has(asset.mimeType)) {
        const document = await db.driveDocument.findUniqueOrThrow({
          where: { folderId_fileId: { folderId: tradeLinkFolderId, fileId: asset.fileId } },
        });
        Object.assign(source, {
          contentHash: createHash('sha256').update(document.content).digest('hex'),
        });
      }
      await db.memory.upsert({
        where: { id: memoryId },
        create: {
          id: memoryId,
          title: `Drive ${textMimes.has(asset.mimeType) ? 'review' : 'asset review'}: ${asset.name}`,
          kind: 'REFERENCE',
          isDemo: false,
          content: JSON.stringify(source),
        },
        update: {
          title: `Drive review: ${asset.name}`,
          content: JSON.stringify(source),
          isDemo: false,
        },
      });
      results.push({
        fileId: asset.fileId,
        name: asset.name,
        path: asset.path,
        mimeType: asset.mimeType,
        status: result.status,
        coverage: result.coverage,
        summary: result.review.summary,
      });
    } catch (error) {
      const reason =
        error instanceof Error &&
        /^(File format not supported|Asset exceeds|Video duration outside|Asset scope|Image signature|Photoshop signature|Video signature|Asset is outside)/.test(
          error.message,
        )
          ? error.message
          : 'Content could not be reviewed: check access, format, media tool support or provider availability.';
      const failureData = {
        source: `https://drive.google.com/file/d/${asset.fileId}/view`,
        modifiedAt: asset.modifiedAt,
        status: 'FAILED',
        coverage: reason,
        summary: 'No current content review completed.',
        previousReview: cached,
      };
      await db.memory.upsert({
        where: { id: memoryId },
        create: {
          id: memoryId,
          title: `Drive review unavailable: ${asset.name}`,
          kind: 'REFERENCE',
          isDemo: false,
          content: JSON.stringify(failureData),
        },
        update: { content: JSON.stringify(failureData), isDemo: false },
      });
      results.push({
        fileId: asset.fileId,
        name: asset.name,
        path: asset.path,
        mimeType: asset.mimeType,
        status: 'FAILED',
        coverage: reason,
        summary:
          'No new content review completed. Any older memory is historical and must not be treated as a current review.',
      });
    }
    console.log(
      'RECURSIVE_FILE_REVIEW ' +
        JSON.stringify({
          position: results.length,
          total: inventory.files.length,
          mimeType: asset.mimeType,
          status: results.at(-1)!.status,
        }),
    );
  }
  const reviewed = results.filter((r) => r.status === 'REVIEWED').length,
    partial = results.filter((r) => r.status === 'PARTIAL').length,
    failed = results.filter((r) => r.status === 'FAILED').length;
  const coverage = `${inventory.files.length} files inventoried recursively across ${inventory.folders.length} folders. ${reviewed} reviewed; ${partial} reviewed with explicit limitations; ${failed} could not be reviewed. Video reviews use sampled frames plus full audio transcription where available. Photoshop reviews cover the flattened composite, not hidden layers. Spreadsheet reviews include cached cells and formulas in every worksheet, not embedded visuals or recalculation.`;
  const report = await db.report.create({
    data: {
      type: 'DRIVE_REVIEW',
      title: `Recursive Drive content review · ${new Date().toISOString().slice(0, 10)}`,
      provider: `openai:${process.env.OPENAI_MODEL || 'gpt-4.1-mini'}`,
      isDemo: false,
      content: `# Recursive Drive content review\n\n${coverage}\n\nInventory captured ${inventory.capturedAt}. Originals remain unchanged.\n\n${results.map((r) => `## ${r.path}\nStatus: ${r.status}\nSource: https://drive.google.com/file/d/${r.fileId}/view\nCoverage: ${r.coverage}\n\n${r.summary}`).join('\n\n')}`,
    },
  });
  await db.memory.upsert({
    where: { id: 'drive-folder-review-coverage' },
    create: {
      id: 'drive-folder-review-coverage',
      title: 'Drive folder review coverage',
      kind: 'REFERENCE',
      isDemo: false,
      content: `${coverage} File-by-file report: ${report.id}. Failed file IDs: ${
        results
          .filter((r) => r.status === 'FAILED')
          .map((r) => r.fileId)
          .join(', ') || 'none'
      }.`,
    },
    update: {
      content: `${coverage} File-by-file report: ${report.id}. Failed file IDs: ${
        results
          .filter((r) => r.status === 'FAILED')
          .map((r) => r.fileId)
          .join(', ') || 'none'
      }.`,
      isDemo: false,
    },
  });
  await db.auditLog.create({
    data: {
      actor: admin.email,
      action: 'DRIVE_RECURSIVE_CONTENT_REVIEW',
      entityType: 'Report',
      entityId: report.id,
      details: JSON.stringify({
        folders: inventory.folders.length,
        files: results.length,
        reviewed,
        partial,
        failed,
        noDriveWrites: true,
      }),
    },
  });
  console.log(
    'RECURSIVE_REVIEW_COMPLETE ' +
      JSON.stringify({
        reportId: report.id,
        folders: inventory.folders.length,
        files: results.length,
        reviewed,
        partial,
        failed,
      }),
  );
  // Regenerate the explicitly requested plan using current imports and all saved file reviews.
  stage = 'refresh-today';
  const refresh = spawnSync(
    'node',
    [
      '--import',
      'tsx',
      'scripts/refresh-today-from-drive.ts',
      '--apply',
      '--reuse-current-import',
      '--reuse-reviewed-documents',
    ],
    { stdio: 'inherit' },
  );
  if (refresh.status !== 0) throw Error('Today refresh did not complete');
}
main()
  .catch(() => {
    console.error(
      'RECURSIVE_REVIEW_FAILED ' +
        JSON.stringify({
          stage,
          note: 'No credentials or content logged; completed file reviews retained for safe resume.',
        }),
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
