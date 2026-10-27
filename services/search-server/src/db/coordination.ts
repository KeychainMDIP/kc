export class SearchUnavailableError extends Error {
    readonly status = 503;
}

export class IndexOwnershipLostError extends SearchUnavailableError {
    constructor() {
        super('Search indexing ownership moved to another instance');
    }
}

export const SEARCH_PROTOCOL_VERSION = 1;
export const SEARCH_SCHEMA_VERSION = 1;
export const SEARCH_LOCK_NAMESPACE = 'search-server';
export const SEARCH_WRITER_LOCK = 'index-writer';
export const SEARCH_SCHEMA_LOCK = 'index-schema';
export const COORDINATION_TIMEOUT_MS = 10_000;

export const SEARCH_TABLES = [
    'network_metric_snapshots', 'sync_state', 'challenge_receipts',
    'did_prefix_references', 'identity_fields', 'identity_schemas',
    'published_credentials', 'did_classifications', 'did_docs', 'did_events', 'blocks',
];

// Views are recreated under the schema guard, so compare their layout rather than PostgreSQL's SQL rendering.
export const SEARCH_LAYOUT_SQL = `
    SELECT jsonb_build_object(
        'columns', (SELECT jsonb_agg(jsonb_build_array(table_name, column_name,
            data_type, is_nullable, column_default) ORDER BY table_name, ordinal_position)
            FROM information_schema.columns WHERE table_schema = current_schema()
            AND (table_name = ANY($1::text[]) OR table_name = ANY($2::text[]))),
        'constraints', (SELECT jsonb_agg(jsonb_build_array(r.relname, c.contype,
            pg_get_constraintdef(c.oid)) ORDER BY r.relname, c.contype, pg_get_constraintdef(c.oid))
            FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = current_schema() AND r.relname = ANY($1::text[])),
        'views', (SELECT jsonb_agg(table_name ORDER BY table_name)
            FROM information_schema.views WHERE table_schema = current_schema()
            AND table_name = ANY($2::text[]))
    ) AS layout
`;

export const SEARCH_VIEWS = [
    'published_credentials_classified', 'did_classifications_effective', 'did_reference_prefixes',
];

export const SEARCH_LAYOUT_HASH = 'fec11b794d5c28a976736c6385635a02b7c89426080c41c432ca77b1bdd07987';
