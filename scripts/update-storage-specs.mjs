// Owner tool. Dry run by default; pass --apply to update recognized legacy actions.
import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';
import { upgradeStorageSpec } from './storage-spec.mjs';
if (!process.env.MU_CLERK_JWT || !process.env.MU_CONVEX_URL) throw new Error('Set MU_CONVEX_URL and a fresh MU_CLERK_JWT securely.');
const client = new ConvexHttpClient(process.env.MU_CONVEX_URL); client.setAuth(process.env.MU_CLERK_JWT);
if (!(await client.query(api.storage.list, {})).isOwner) throw new Error('Only the application owner can migrate specs.');
const specs = await client.query(api.specs.list, {});
if (specs.length >= 100) throw new Error('Spec list reached its bound; migrate in smaller explicit groups instead of silently skipping specs.');
for (const spec of specs) {
  const update = upgradeStorageSpec(spec.yaml);
  if (!update.changes) continue;
  if (process.argv.includes('--apply')) {
    await client.mutation(api.artifactMigration.updateSpec, { id: spec._id, expectedYaml: spec.yaml, yaml: update.yaml });
  }
  console.log(`${spec.slug}: ${update.changes} artifact protocol changes ${process.argv.includes('--apply') ? 'applied' : '(preview; use --apply)'}`);
}
