# Wardrobe SSD consolidation — 2026-10-02

## Additional preservation — 2026-10-03

The same private archive collection now also contains `releases-20261003`
(four old beta release trees) and `ops-followup-20261003` (three complete
source/install/job roots and all regular contents of a fourth historical
clone). Both batches passed full source-to-archive verification and real
restoration. The fourth clone's external dependency symlink was not followed;
its literal target and parent/link metadata are retained in a separate sealed
pointer receipt. That generated receipt's own subsecond mtime rounded on
restore; its bytes and the original metadata encoded inside it match. All
44 original data roots in the second batch restored exactly.

Deletion and measured free-space receipts remain in the private operational
audit. A preservation record alone does not authorize deleting an active
checkout, dependency, runtime, provider account or agent history. Keep one
working release and its explicit rollback; verify current handles and links
before retiring other copies. The dated measurements below describe the
October 2 operation only.

## Completed October 2 operation

Completed owner-approved conservation before cleanup. Private paths, manifests, inputs, API keys and generation receipts are not published here.

- One private legacy archive collection contains self-contained `builds`, `historical` and `git-history` batches. SHA-256-addressed blobs are accompanied by original-path, permission, timestamp, ownership, xattr and link manifests and a restoration tool.
- All 38 historical release builds/candidates were compared; none was a whole-tree duplicate. Their 1,425 distinct file blobs occupy 571,296,779 logical bytes. All were preserved before the 38 original trees were removed.
- A further 787 historical directories/files were preserved and removed after complete source-to-archive checks. Existing compressed scene and product backups were preserved intact as opaque blobs.
- Real restoration checks reconstructed one release candidate (868 entries) and one historical release (851 entries); content and metadata matched exactly. No original was removed before archive verification.
- Git metadata was separately copied and verified, but original Git history remains in place. One historical repository still serves an external linked worktree; six older worktree pointer files already refer to unavailable parents. Archival does not invent missing Git objects.
- Provider/auth/session/cache state remains in place, including private credential data discovered outside the expected cache roots. Excluded relative links retain their target packages. Canonical source, active artifacts, working runtime and private original video references remain untouched.
- Cleanup gates checked current open files/cwd, file/metadata changes, links/hardlinks, and 11,276 active source/config/runtime text files for references to the retired build roots (none found). macOS-protected revisions, temporary-items and Trash directories were excluded from scanning and cleanup; no access-control changes were made there.
- Net observed volume free-space increase, after creating the archive and removing only agent-owned test fixtures: **23.413 GiB**. Remaining free space: **140.397 GiB**. These are measured volume deltas, not sums of overlapping directory sizes.

The private operational receipt includes exact removed paths and archive manifest digests. Use archive-only verification after cleanup; source-comparison verification requires still-present originals. Restoration writes to a NEW destination, never a live runtime or canonical checkout. Keep the archive private and preserve its manifest seals.

This operation did not activate a new product release and did not change provider permissions. A healthy public endpoint is not proof of a paid generation.
