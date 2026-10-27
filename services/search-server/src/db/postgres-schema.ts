import { AMBIGUOUS_DID_PREFIX } from '../did-aliases.js';

export const SEARCH_SCHEMA_SQL = `
            CREATE TABLE IF NOT EXISTS did_events (
                did TEXT NOT NULL,
                event_index INTEGER NOT NULL,
                registry TEXT NOT NULL,
                time TEXT NOT NULL,
                event JSONB NOT NULL,
                PRIMARY KEY (did, event_index)
            );

            CREATE INDEX IF NOT EXISTS idx_did_events_did
                ON did_events (did);

            CREATE INDEX IF NOT EXISTS idx_did_events_registry_time
                ON did_events (registry, time);

            CREATE TABLE IF NOT EXISTS did_classifications (
                suffix TEXT PRIMARY KEY,
                did TEXT NOT NULL UNIQUE,
                prefix TEXT NOT NULL,
                prefix_authoritative BOOLEAN NOT NULL,
                is_agent BOOLEAN NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_did_classifications_prefix
                ON did_classifications (prefix);

            CREATE INDEX IF NOT EXISTS idx_did_classifications_agents
                ON did_classifications (is_agent, prefix COLLATE "C", suffix COLLATE "C");

            CREATE TABLE IF NOT EXISTS did_docs (
                did TEXT PRIMARY KEY,
                doc JSONB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS blocks (
                registry TEXT NOT NULL,
                hash TEXT NOT NULL,
                height INTEGER NOT NULL,
                time INTEGER NOT NULL,
                block JSONB NOT NULL,
                PRIMARY KEY (registry, hash)
            );

            CREATE INDEX IF NOT EXISTS idx_blocks_registry_height
                ON blocks (registry, height);

            CREATE TABLE IF NOT EXISTS published_credentials (
                holder_did TEXT NOT NULL,
                credential_suffix TEXT NOT NULL,
                schema_suffix TEXT NOT NULL,
                issuer_did TEXT NOT NULL,
                subject_did TEXT NOT NULL,
                revealed BOOLEAN,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (holder_did, credential_suffix)
            );

            CREATE INDEX IF NOT EXISTS idx_published_credentials_suffixes
                ON published_credentials (credential_suffix, schema_suffix);

            CREATE TABLE IF NOT EXISTS identity_schemas (
                did TEXT NOT NULL,
                schema_suffix TEXT NOT NULL,
                PRIMARY KEY (did, schema_suffix)
            );

            CREATE TABLE IF NOT EXISTS identity_fields (
                did TEXT NOT NULL,
                field TEXT NOT NULL,
                schema_suffix TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_identity_fields_lookup
                ON identity_fields (did, md5(field), schema_suffix);

            CREATE TABLE IF NOT EXISTS did_prefix_references (
                source_did TEXT NOT NULL,
                suffix TEXT NOT NULL,
                prefix TEXT NOT NULL,
                PRIMARY KEY (source_did, suffix, prefix)
            );

            CREATE INDEX IF NOT EXISTS idx_did_prefix_references_suffix_prefix
                ON did_prefix_references (suffix, prefix);

            CREATE OR REPLACE VIEW did_reference_prefixes AS
                SELECT suffix,
                       CASE WHEN MIN(prefix) = MAX(prefix)
                           THEN MIN(prefix)
                           ELSE '${AMBIGUOUS_DID_PREFIX}'
                       END AS prefix,
                       COUNT(DISTINCT prefix)::int AS prefix_count
                FROM did_prefix_references
                GROUP BY suffix;

            CREATE OR REPLACE VIEW did_classifications_effective AS
                SELECT dc.suffix,
                       dc.did,
                       CASE WHEN dc.prefix_authoritative OR dc.is_agent THEN dc.prefix
                           ELSE COALESCE(rp.prefix, '${AMBIGUOUS_DID_PREFIX}')
                       END AS prefix,
                       NOT dc.prefix_authoritative
                           AND (dc.is_agent OR COALESCE(rp.prefix_count, 0) <> 1) AS prefix_ambiguous
                FROM did_classifications dc
                LEFT JOIN did_reference_prefixes rp ON rp.suffix = dc.suffix;

            CREATE OR REPLACE VIEW published_credentials_classified AS
                SELECT pc.*,
                       CASE WHEN cc.prefix_authoritative OR cc.is_agent THEN cc.prefix ELSE cr.prefix END AS credential_effective_prefix,
                       CASE WHEN sc.prefix_authoritative OR sc.is_agent THEN sc.prefix ELSE sr.prefix END AS schema_effective_prefix,
                       CASE WHEN cc.suffix IS NULL THEN COALESCE(cr.prefix_count, 0) <> 1
                            ELSE NOT cc.prefix_authoritative
                                 AND (cc.is_agent OR COALESCE(cr.prefix_count, 0) <> 1)
                       END AS credential_prefix_ambiguous,
                       CASE WHEN sc.suffix IS NULL THEN COALESCE(sr.prefix_count, 0) <> 1
                            ELSE NOT sc.prefix_authoritative
                                 AND (sc.is_agent OR COALESCE(sr.prefix_count, 0) <> 1)
                       END AS schema_prefix_ambiguous
                FROM published_credentials pc
                LEFT JOIN did_classifications cc ON cc.suffix = pc.credential_suffix
                LEFT JOIN did_classifications sc ON sc.suffix = pc.schema_suffix
                JOIN did_reference_prefixes cr ON cr.suffix = pc.credential_suffix
                JOIN did_reference_prefixes sr ON sr.suffix = pc.schema_suffix;

            CREATE TABLE IF NOT EXISTS challenge_receipts (
                receipt_did TEXT PRIMARY KEY,
                attester_did TEXT NOT NULL,
                attester_suffix TEXT NOT NULL,
                schema_did TEXT NOT NULL,
                schema_suffix TEXT NOT NULL,
                requester_did TEXT NOT NULL,
                requester_suffix TEXT NOT NULL,
                response_commitment TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_attester
                ON challenge_receipts (attester_suffix);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_schema
                ON challenge_receipts (schema_suffix);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_requester
                ON challenge_receipts (requester_suffix);

            CREATE INDEX IF NOT EXISTS idx_challenge_receipts_commitment
                ON challenge_receipts (response_commitment);

            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS network_metric_snapshots (
                snapshot_date TEXT PRIMARY KEY,
                did_count INTEGER NOT NULL CHECK (did_count >= 0),
                did_counts_by_prefix JSONB NOT NULL DEFAULT '{}'::jsonb,
                agent_did_count INTEGER NOT NULL CHECK (agent_did_count >= 0),
                agent_did_counts_by_prefix JSONB NOT NULL DEFAULT '{}'::jsonb,
                credential_count INTEGER NOT NULL CHECK (credential_count >= 0),
                credential_did_counts_by_prefix JSONB NOT NULL DEFAULT '{}'::jsonb,
                schema_counts JSONB NOT NULL DEFAULT '[]'::jsonb,
                rebuilt_at TEXT NOT NULL
            );
        `;
