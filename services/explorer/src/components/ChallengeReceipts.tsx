import React, { useCallback, useEffect, useMemo, useState } from "react";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import {
    Box,
    Button,
    FormControl,
    MenuItem,
    Select,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    TextField,
    Typography,
} from "@mui/material";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
    pageSizeOptions,
    receiptBrowseFetchLimit,
    usageFetchLimit,
} from "../config.js";
import {
    fetchChallengeReceipts,
    fetchChallengeReceiptUsage,
    type ChallengeReceiptRow,
    type ChallengeReceiptUsageRow,
} from "../api/searchClient.js";
import { useSnackbar } from "../contexts/SnackbarProvider.js";

const receiptTableSx = {
    tableLayout: "fixed",
    "& th, & td": {
        px: 1.25,
    },
    "& th": {
        whiteSpace: "nowrap",
    },
};
const compactNumberColumnSx = {
    width: 86,
    textAlign: "right",
};
const compactDateColumnSx = {
    width: 142,
};

type SortDirection = "asc" | "desc";
type AttesterSortKey = "attesterDid" | "count" | "templateCount" | "requesterCount" | "firstUpdatedAt" | "lastUpdatedAt";
type UsageSortKey = "schemaDid" | "requesterDid" | "count" | "firstUpdatedAt" | "lastUpdatedAt";
type ReceiptSortKey = "updatedAt" | "receiptDid";

interface SortState<Key extends string> {
    key: Key;
    direction: SortDirection;
}

interface AttesterUsageRow {
    attesterDid: string;
    count: number;
    templateCount: number;
    requesterCount: number;
    firstUpdatedAt: string;
    lastUpdatedAt: string;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);

    if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
    }

    return fallback;
}

function parseNonNegativeInteger(value: string | null, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);

    if (Number.isInteger(parsed) && parsed >= 0) {
        return parsed;
    }

    return fallback;
}

function formatTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return `${date.toISOString().replace("T", " ").slice(0, 16)}Z`;
}

function compareText(a: string, b: string): number {
    return a.localeCompare(b);
}

function compareNumber(a: number, b: number): number {
    return a - b;
}

function compareTimestamp(a: string, b: string): number {
    const aTime = Date.parse(a);
    const bTime = Date.parse(b);

    if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return compareText(a, b);
    }

    return aTime - bTime;
}

function applySortDirection(value: number, direction: SortDirection): number {
    return direction === "asc" ? value : -value;
}

function SortableHeader<Key extends string>(
    {
        label,
        sortKey,
        sort,
        onSort,
        width,
        sx,
    }: {
        label: string;
        sortKey: Key;
        sort: SortState<Key>;
        onSort: (key: Key) => void;
        width?: number | string;
        sx?: object;
    }
) {
    return (
        <TableCell width={width} sortDirection={sort.key === sortKey ? sort.direction : false} sx={sx}>
            <TableSortLabel
                active={sort.key === sortKey}
                direction={sort.key === sortKey ? sort.direction : "asc"}
                onClick={() => onSort(sortKey)}
            >
                {label}
            </TableSortLabel>
        </TableCell>
    );
}

function getStartOfDay(value: string): string | undefined {
    if (!value) {
        return undefined;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getEndOfDay(value: string): string | undefined {
    if (!value) {
        return undefined;
    }

    const date = new Date(`${value}T23:59:59.999Z`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function DidLink(
    {
        did,
        maxWidth = "100%",
    }: {
        did: string;
        maxWidth?: number | string;
    }
) {
    return (
        <Typography
            component={RouterLink}
            to={`/search?did=${encodeURIComponent(did)}`}
            title={did}
            onClick={(event) => {
                event.stopPropagation();
            }}
            sx={{
                display: "block",
                fontFamily: "Courier, monospace",
                textDecoration: "underline",
                color: "primary.main",
                cursor: "pointer",
                maxWidth,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {did}
        </Typography>
    );
}

function SelectableDid(
    {
        did,
        onClick,
        maxWidth = 420,
    }: {
        did: string;
        onClick: () => void;
        maxWidth?: number | string;
    }
) {
    return (
        <Typography
            title={did}
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
            sx={{
                display: "block",
                fontFamily: "Courier, monospace",
                textDecoration: "underline",
                color: "primary.main",
                cursor: "pointer",
                maxWidth,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {did}
        </Typography>
    );
}

function SummaryCard(
    {
        label,
        value,
    }: {
        label: string;
        value: number;
    }
) {
    return (
        <Box
            sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                p: 2,
                minWidth: 230,
                flex: "1 1 230px",
            }}
        >
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
                <Typography
                    sx={{
                        fontSize: "0.9rem",
                        fontWeight: 500,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                    }}
                >
                    {label}
                </Typography>
                <Typography variant="h4" sx={{ fontSize: "2.1rem", lineHeight: 1 }}>
                    {value}
                </Typography>
            </Box>
        </Box>
    );
}

function groupReceiptsByAttester(receipts: ChallengeReceiptRow[]): AttesterUsageRow[] {
    const groups = new Map<string, {
        commitments: Set<string>;
        requesters: Set<string>;
        templates: Set<string>;
        row: AttesterUsageRow;
    }>();

    for (const receipt of receipts) {
        const existing = groups.get(receipt.attesterDid);

        if (!existing) {
            groups.set(receipt.attesterDid, {
                commitments: new Set([receipt.responseCommitment]),
                requesters: new Set([receipt.requesterDid]),
                templates: new Set([receipt.schemaDid]),
                row: {
                    attesterDid: receipt.attesterDid,
                    count: 1,
                    templateCount: 1,
                    requesterCount: 1,
                    firstUpdatedAt: receipt.updatedAt,
                    lastUpdatedAt: receipt.updatedAt,
                },
            });
            continue;
        }

        existing.commitments.add(receipt.responseCommitment);
        existing.requesters.add(receipt.requesterDid);
        existing.templates.add(receipt.schemaDid);
        existing.row.count = existing.commitments.size;
        existing.row.requesterCount = existing.requesters.size;
        existing.row.templateCount = existing.templates.size;

        if (receipt.updatedAt < existing.row.firstUpdatedAt) {
            existing.row.firstUpdatedAt = receipt.updatedAt;
        }
        if (receipt.updatedAt > existing.row.lastUpdatedAt) {
            existing.row.lastUpdatedAt = receipt.updatedAt;
        }
    }

    return Array.from(groups.values())
        .map(group => group.row)
        .sort((a, b) => b.count - a.count || a.attesterDid.localeCompare(b.attesterDid));
}

function compareAttesterRows(a: AttesterUsageRow, b: AttesterUsageRow, sort: SortState<AttesterSortKey>): number {
    let result: number;

    switch (sort.key) {
    case "count":
        result = compareNumber(a.count, b.count);
        break;
    case "templateCount":
        result = compareNumber(a.templateCount, b.templateCount);
        break;
    case "requesterCount":
        result = compareNumber(a.requesterCount, b.requesterCount);
        break;
    case "firstUpdatedAt":
        result = compareTimestamp(a.firstUpdatedAt, b.firstUpdatedAt);
        break;
    case "lastUpdatedAt":
        result = compareTimestamp(a.lastUpdatedAt, b.lastUpdatedAt);
        break;
    case "attesterDid":
    default:
        result = compareText(a.attesterDid, b.attesterDid);
        break;
    }

    return applySortDirection(result, sort.direction) || compareText(a.attesterDid, b.attesterDid);
}

function compareUsageRows(a: ChallengeReceiptUsageRow, b: ChallengeReceiptUsageRow, sort: SortState<UsageSortKey>): number {
    let result: number;

    switch (sort.key) {
    case "requesterDid":
        result = compareText(a.requesterDid, b.requesterDid);
        break;
    case "count":
        result = compareNumber(a.count, b.count);
        break;
    case "firstUpdatedAt":
        result = compareTimestamp(a.firstUpdatedAt, b.firstUpdatedAt);
        break;
    case "lastUpdatedAt":
        result = compareTimestamp(a.lastUpdatedAt, b.lastUpdatedAt);
        break;
    case "schemaDid":
    default:
        result = compareText(a.schemaDid, b.schemaDid);
        break;
    }

    return applySortDirection(result, sort.direction)
        || compareText(a.schemaDid, b.schemaDid)
        || compareText(a.requesterDid, b.requesterDid);
}

function compareReceiptRows(a: ChallengeReceiptRow, b: ChallengeReceiptRow, sort: SortState<ReceiptSortKey>): number {
    const result = sort.key === "receiptDid"
        ? compareText(a.receiptDid, b.receiptDid)
        : compareTimestamp(a.updatedAt, b.updatedAt);

    return applySortDirection(result, sort.direction) || compareText(a.receiptDid, b.receiptDid);
}

function ChallengeReceipts() {
    const { setError } = useSnackbar();
    const [searchParams, setSearchParams] = useSearchParams();
    const [draftAttesterDid, setDraftAttesterDid] = useState<string>(searchParams.get("attesterDid") ?? "");
    const [draftDateFrom, setDraftDateFrom] = useState<string>(searchParams.get("dateFrom") ?? "");
    const [draftDateTo, setDraftDateTo] = useState<string>(searchParams.get("dateTo") ?? "");
    const [attesterRows, setAttesterRows] = useState<AttesterUsageRow[]>([]);
    const [usageRows, setUsageRows] = useState<ChallengeReceiptUsageRow[]>([]);
    const [receipts, setReceipts] = useState<ChallengeReceiptRow[]>([]);
    const [isAttesterLoading, setIsAttesterLoading] = useState<boolean>(false);
    const [isUsageLoading, setIsUsageLoading] = useState<boolean>(false);
    const [isReceiptLoading, setIsReceiptLoading] = useState<boolean>(false);
    const [attesterSort, setAttesterSort] = useState<SortState<AttesterSortKey>>({
        key: "lastUpdatedAt",
        direction: "desc",
    });
    const [usageSort, setUsageSort] = useState<SortState<UsageSortKey>>({
        key: "lastUpdatedAt",
        direction: "desc",
    });
    const [receiptSort, setReceiptSort] = useState<SortState<ReceiptSortKey>>({
        key: "updatedAt",
        direction: "desc",
    });

    const attesterDid = searchParams.get("attesterDid") ?? "";
    const dateFrom = searchParams.get("dateFrom") ?? "";
    const dateTo = searchParams.get("dateTo") ?? "";
    const selectedSchemaDid = searchParams.get("detailSchemaDid") ?? "";
    const selectedRequesterDid = searchParams.get("detailRequesterDid") ?? "";
    const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 25);
    const page = parseNonNegativeInteger(searchParams.get("page"), 0);
    const receiptPageSize = parsePositiveInteger(searchParams.get("receiptPageSize"), 25);
    const receiptPage = parseNonNegativeInteger(searchParams.get("receiptPage"), 0);

    const updatedAfter = useMemo(() => getStartOfDay(dateFrom), [dateFrom]);
    const updatedBefore = useMemo(() => getEndOfDay(dateTo), [dateTo]);

    const filteredAttesterRows = useMemo(() => {
        const query = draftAttesterDid.trim().toLowerCase();

        if (!query || attesterDid) {
            return attesterRows;
        }

        return attesterRows.filter(row => row.attesterDid.toLowerCase().includes(query));
    }, [attesterDid, attesterRows, draftAttesterDid]);

    const sortedAttesterRows = useMemo(
        () => [...filteredAttesterRows].sort((a, b) => compareAttesterRows(a, b, attesterSort)),
        [attesterSort, filteredAttesterRows]
    );

    const sortedUsageRows = useMemo(
        () => [...usageRows].sort((a, b) => compareUsageRows(a, b, usageSort)),
        [usageRows, usageSort]
    );

    const sortedReceipts = useMemo(
        () => [...receipts].sort((a, b) => compareReceiptRows(a, b, receiptSort)),
        [receipts, receiptSort]
    );

    const totalPages = Math.max(1, Math.ceil(usageRows.length / pageSize));
    const attesterTotalPages = Math.max(1, Math.ceil(sortedAttesterRows.length / pageSize));
    const receiptTotalPages = Math.max(1, Math.ceil(receipts.length / receiptPageSize));
    const pagedUsageRows = useMemo(() => {
        const from = page * pageSize;
        const to = from + pageSize;

        return sortedUsageRows.slice(from, to);
    }, [page, pageSize, sortedUsageRows]);
    const pagedAttesterRows = useMemo(() => {
        const from = page * pageSize;
        const to = from + pageSize;

        return sortedAttesterRows.slice(from, to);
    }, [page, pageSize, sortedAttesterRows]);
    const pagedReceiptRows = useMemo(() => {
        const from = receiptPage * receiptPageSize;
        const to = from + receiptPageSize;

        return sortedReceipts.slice(from, to);
    }, [receiptPage, receiptPageSize, sortedReceipts]);

    const selectedUsageRow = useMemo(
        () => usageRows.find(row => row.schemaDid === selectedSchemaDid && row.requesterDid === selectedRequesterDid) ?? null,
        [selectedRequesterDid, selectedSchemaDid, usageRows]
    );

    const totalSuccessfulUses = useMemo(
        () => usageRows.reduce((sum, row) => sum + row.count, 0),
        [usageRows]
    );
    const templateCount = useMemo(
        () => new Set(usageRows.map(row => row.schemaDid)).size,
        [usageRows]
    );
    const requesterCount = useMemo(
        () => new Set(usageRows.map(row => row.requesterDid)).size,
        [usageRows]
    );

    const updateParams = useCallback((
        updates: Record<string, string | null | undefined>,
        options?: { replace?: boolean }
    ) => {
        const next = new URLSearchParams(searchParams);

        for (const [key, value] of Object.entries(updates)) {
            if (!value) {
                next.delete(key);
            }
            else {
                next.set(key, value);
            }
        }

        setSearchParams(next, options);
    }, [searchParams, setSearchParams]);

    function handleSearch() {
        const next = new URLSearchParams();

        if (draftAttesterDid.trim()) {
            next.set("attesterDid", draftAttesterDid.trim());
        }
        if (draftDateFrom) {
            next.set("dateFrom", draftDateFrom);
        }
        if (draftDateTo) {
            next.set("dateTo", draftDateTo);
        }
        next.set("page", "0");
        next.set("pageSize", pageSize.toString());

        setSearchParams(next);
    }

    function handleSelectAttester(nextAttesterDid: string) {
        const next = new URLSearchParams();

        next.set("attesterDid", nextAttesterDid);
        if (draftDateFrom) {
            next.set("dateFrom", draftDateFrom);
        }
        if (draftDateTo) {
            next.set("dateTo", draftDateTo);
        }
        next.set("page", "0");
        next.set("pageSize", pageSize.toString());

        setSearchParams(next);
    }

    function handleSelectUsageRow(row: ChallengeReceiptUsageRow) {
        updateParams({
            detailSchemaDid: row.schemaDid,
            detailRequesterDid: row.requesterDid,
            receiptPage: "0",
        });
    }

    function handleBackFromReceipts() {
        updateParams({
            detailSchemaDid: null,
            detailRequesterDid: null,
            receiptPage: null,
        }, { replace: true });
    }

    function handleBackFromUsage() {
        updateParams({
            attesterDid: null,
            detailSchemaDid: null,
            detailRequesterDid: null,
            page: "0",
            receiptPage: null,
        }, { replace: true });
    }

    function toggleAttesterSort(key: AttesterSortKey) {
        setAttesterSort((current) => ({
            key,
            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
        }));
        updateParams({ page: "0" });
    }

    function toggleUsageSort(key: UsageSortKey) {
        setUsageSort((current) => ({
            key,
            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
        }));
        updateParams({ page: "0" });
    }

    function toggleReceiptSort(key: ReceiptSortKey) {
        setReceiptSort((current) => ({
            key,
            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
        }));
        updateParams({ receiptPage: "0" });
    }

    useEffect(() => {
        setDraftAttesterDid(searchParams.get("attesterDid") ?? "");
        setDraftDateFrom(searchParams.get("dateFrom") ?? "");
        setDraftDateTo(searchParams.get("dateTo") ?? "");
    }, [searchParams]);

    useEffect(() => {
        let ignore = false;

        async function fetchAttesterRows() {
            if (attesterDid) {
                setAttesterRows([]);
                setIsAttesterLoading(false);
                return;
            }

            setIsAttesterLoading(true);

            try {
                const allReceipts: ChallengeReceiptRow[] = [];
                let offset = 0;
                let total = 0;

                do {
                    const result = await fetchChallengeReceipts({
                        updatedAfter,
                        updatedBefore,
                        limit: receiptBrowseFetchLimit,
                        offset,
                    });

                    total = result.total;
                    allReceipts.push(...result.receipts);
                    offset += receiptBrowseFetchLimit;
                } while (offset < total);

                if (!ignore) {
                    setAttesterRows(groupReceiptsByAttester(allReceipts));
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setAttesterRows([]);
                    setError(error);
                }
            }
            finally {
                if (!ignore) {
                    setIsAttesterLoading(false);
                }
            }
        }

        fetchAttesterRows();

        return () => {
            ignore = true;
        };
    }, [attesterDid, setError, updatedAfter, updatedBefore]);

    useEffect(() => {
        let ignore = false;

        async function fetchUsageRows() {
            if (!attesterDid) {
                setUsageRows([]);
                setReceipts([]);
                return;
            }

            setIsUsageLoading(true);

            try {
                const allRows: ChallengeReceiptUsageRow[] = [];
                let offset = 0;
                let total = 0;

                do {
                    const result = await fetchChallengeReceiptUsage({
                        attesterDid,
                        updatedAfter,
                        updatedBefore,
                        limit: usageFetchLimit,
                        offset,
                    });

                    total = result.total;
                    allRows.push(...result.usage);
                    offset += usageFetchLimit;
                } while (offset < total);

                if (!ignore) {
                    setUsageRows(allRows);
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setUsageRows([]);
                    setError(error);
                }
            }
            finally {
                if (!ignore) {
                    setIsUsageLoading(false);
                }
            }
        }

        fetchUsageRows();

        return () => {
            ignore = true;
        };
    }, [attesterDid, setError, updatedAfter, updatedBefore]);

    useEffect(() => {
        const rowCount = attesterDid ? sortedUsageRows.length : sortedAttesterRows.length;
        const maxPage = Math.max(0, Math.ceil(rowCount / pageSize) - 1);

        if (page > maxPage) {
            updateParams({ page: "0" }, { replace: true });
        }
    }, [attesterDid, page, pageSize, sortedAttesterRows.length, sortedUsageRows.length, updateParams]);

    useEffect(() => {
        let ignore = false;

        async function fetchReceiptRows() {
            if (!attesterDid || !selectedSchemaDid || !selectedRequesterDid) {
                setReceipts([]);
                return;
            }

            setIsReceiptLoading(true);

            try {
                const allReceipts: ChallengeReceiptRow[] = [];
                let offset = 0;
                let total = 0;

                do {
                    const result = await fetchChallengeReceipts({
                        attesterDid,
                        schemaDid: selectedSchemaDid,
                        requesterDid: selectedRequesterDid,
                        updatedAfter,
                        updatedBefore,
                        limit: receiptBrowseFetchLimit,
                        offset,
                    });

                    total = result.total;
                    allReceipts.push(...result.receipts);
                    offset += receiptBrowseFetchLimit;
                } while (offset < total);

                if (!ignore) {
                    if (allReceipts.length > 0 && receiptPage * receiptPageSize >= allReceipts.length && receiptPage > 0) {
                        updateParams({ receiptPage: "0" });
                        return;
                    }

                    setReceipts(allReceipts);
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setReceipts([]);
                    setError(error);
                }
            }
            finally {
                if (!ignore) {
                    setIsReceiptLoading(false);
                }
            }
        }

        fetchReceiptRows();

        return () => {
            ignore = true;
        };
    }, [
        attesterDid,
        receiptPage,
        receiptPageSize,
        selectedRequesterDid,
        selectedSchemaDid,
        setError,
        updateParams,
        updatedAfter,
        updatedBefore,
    ]);

    return (
        <Box sx={{ ml: 1, mt: 2, minWidth: 860 }}>
            {selectedUsageRow ? (
                <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                        <Button
                            variant="outlined"
                            onClick={handleBackFromReceipts}
                            startIcon={<ArrowBackIosNewIcon fontSize="small" />}
                        >
                            Back
                        </Button>
                        <Typography variant="h6">Receipts</Typography>
                    </Box>

                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 3 }}>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
                            <Typography variant="overline" sx={{ minWidth: 100 }}>
                                Schema
                            </Typography>
                            <DidLink did={selectedUsageRow.schemaDid} maxWidth="100%" />
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
                            <Typography variant="overline" sx={{ minWidth: 100 }}>
                                Requester
                            </Typography>
                            <DidLink did={selectedUsageRow.requesterDid} maxWidth="100%" />
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
                            <Typography variant="overline" sx={{ minWidth: 100 }}>
                                Uses
                            </Typography>
                            <Typography>{selectedUsageRow.count}</Typography>
                        </Box>
                    </Box>

                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                        <Typography>
                            {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
                        </Typography>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                            <FormControl size="small" sx={{ minWidth: 100 }}>
                                <Select
                                    value={receiptPageSize}
                                    onChange={(event) => updateParams({
                                        receiptPageSize: String(event.target.value),
                                        receiptPage: "0",
                                    })}
                                >
                                    {pageSizeOptions.map((option) => (
                                        <MenuItem key={option} value={option}>
                                            {option}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Box display="flex" alignItems="center" gap={1}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={receiptPage === 0}
                                    onClick={() => updateParams({ receiptPage: String(receiptPage - 1) })}
                                >
                                    Prev
                                </Button>
                                <Typography>
                                    Page {Math.min(receiptPage + 1, receiptTotalPages)} / {receiptTotalPages}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={receiptPage + 1 >= receiptTotalPages}
                                    onClick={() => updateParams({ receiptPage: String(receiptPage + 1) })}
                                >
                                    Next
                                </Button>
                            </Box>
                        </Box>
                    </Box>

                    {isReceiptLoading ? (
                        <Typography>Loading receipts...</Typography>
                    ) : receipts.length === 0 ? (
                        <Typography>No receipts found for this usage row.</Typography>
                    ) : (
                        <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <Table size="small" sx={receiptTableSx}>
                                <TableHead>
                                    <TableRow>
                                        <SortableHeader
                                            label="Updated"
                                            sortKey="updatedAt"
                                            sort={receiptSort}
                                            onSort={toggleReceiptSort}
                                            sx={compactDateColumnSx}
                                        />
                                        <SortableHeader
                                            label="Receipt DID"
                                            sortKey="receiptDid"
                                            sort={receiptSort}
                                            onSort={toggleReceiptSort}
                                        />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {pagedReceiptRows.map((row) => (
                                        <TableRow key={row.receiptDid}>
                                            <TableCell>{formatTimestamp(row.updatedAt)}</TableCell>
                                            <TableCell>
                                                <DidLink did={row.receiptDid} maxWidth="none" />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </>
            ) : (
                <>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 3 }}>
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                            <TextField
                                label="Attester DID"
                                value={draftAttesterDid}
                                onChange={(event) => setDraftAttesterDid(event.target.value)}
                                size="small"
                                required
                                sx={{ flex: "1 1 100%" }}
                            />
                        </Box>
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
                            <TextField
                                label="From"
                                type="date"
                                value={draftDateFrom}
                                onChange={(event) => setDraftDateFrom(event.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                                sx={{ width: 180 }}
                            />
                            <TextField
                                label="To"
                                type="date"
                                value={draftDateTo}
                                onChange={(event) => setDraftDateTo(event.target.value)}
                                size="small"
                                InputLabelProps={{ shrink: true }}
                                sx={{ width: 180 }}
                            />
                            <Button
                                variant="contained"
                                onClick={handleSearch}
                            >
                                Search
                            </Button>
                        </Box>
                    </Box>

                    {!attesterDid ? (
                        <>
                            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                                <Box>
                                    <Typography variant="h6">Attesters</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Select an attester to view usage.
                                    </Typography>
                                </Box>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                                    <FormControl size="small" sx={{ minWidth: 100 }}>
                                        <Select
                                            value={pageSize}
                                            onChange={(event) => updateParams({
                                                pageSize: String(event.target.value),
                                                page: "0",
                                            })}
                                        >
                                            {pageSizeOptions.map((option) => (
                                                <MenuItem key={option} value={option}>
                                                    {option}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            disabled={page === 0}
                                            onClick={() => updateParams({ page: String(page - 1) })}
                                        >
                                            Prev
                                        </Button>
                                        <Typography>
                                            Page {Math.min(page + 1, attesterTotalPages)} / {attesterTotalPages}
                                        </Typography>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            disabled={page + 1 >= attesterTotalPages}
                                            onClick={() => updateParams({ page: String(page + 1) })}
                                        >
                                            Next
                                        </Button>
                                    </Box>
                                </Box>
                            </Box>

                            {isAttesterLoading ? (
                                <Typography>Loading attesters...</Typography>
                            ) : filteredAttesterRows.length === 0 ? (
                                <Typography>No challenge receipt usage found.</Typography>
                            ) : (
                                <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                                    <Table size="small" sx={receiptTableSx}>
                                        <TableHead>
                                            <TableRow>
                                                <SortableHeader
                                                    label="Attester DID"
                                                    sortKey="attesterDid"
                                                    sort={attesterSort}
                                                    onSort={toggleAttesterSort}
                                                />
                                                <SortableHeader
                                                    label="Uses"
                                                    sortKey="count"
                                                    sort={attesterSort}
                                                    onSort={toggleAttesterSort}
                                                    sx={compactNumberColumnSx}
                                                />
                                                <SortableHeader
                                                    label="Templates"
                                                    sortKey="templateCount"
                                                    sort={attesterSort}
                                                    onSort={toggleAttesterSort}
                                                    sx={compactNumberColumnSx}
                                                />
                                                <SortableHeader
                                                    label="Requesters"
                                                    sortKey="requesterCount"
                                                    sort={attesterSort}
                                                    onSort={toggleAttesterSort}
                                                    sx={compactNumberColumnSx}
                                                />
                                                <SortableHeader
                                                    label="First Updated"
                                                    sortKey="firstUpdatedAt"
                                                    sort={attesterSort}
                                                    onSort={toggleAttesterSort}
                                                    sx={compactDateColumnSx}
                                                />
                                                <SortableHeader
                                                    label="Last Updated"
                                                    sortKey="lastUpdatedAt"
                                                    sort={attesterSort}
                                                    onSort={toggleAttesterSort}
                                                    sx={compactDateColumnSx}
                                                />
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {pagedAttesterRows.map((row) => (
                                                <TableRow
                                                    key={row.attesterDid}
                                                    hover
                                                    onClick={() => handleSelectAttester(row.attesterDid)}
                                                    sx={{ cursor: "pointer" }}
                                                >
                                                    <TableCell>
                                                        <SelectableDid
                                                            did={row.attesterDid}
                                                            onClick={() => handleSelectAttester(row.attesterDid)}
                                                        />
                                                    </TableCell>
                                                    <TableCell sx={compactNumberColumnSx}>{row.count}</TableCell>
                                                    <TableCell sx={compactNumberColumnSx}>{row.templateCount}</TableCell>
                                                    <TableCell sx={compactNumberColumnSx}>{row.requesterCount}</TableCell>
                                                    <TableCell>{formatTimestamp(row.firstUpdatedAt)}</TableCell>
                                                    <TableCell>{formatTimestamp(row.lastUpdatedAt)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </>
                    ) : (
                        <>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                                <Button
                                    variant="outlined"
                                    onClick={handleBackFromUsage}
                                    startIcon={<ArrowBackIosNewIcon fontSize="small" />}
                                >
                                    Back
                                </Button>
                                <Typography variant="h6">Usage</Typography>
                            </Box>
                            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
                                <SummaryCard label="Successful Uses" value={totalSuccessfulUses} />
                                <SummaryCard label="Templates Used" value={templateCount} />
                                <SummaryCard label="Requesters" value={requesterCount} />
                            </Box>

                            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 2 }}>
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="overline">Attester</Typography>
                                    <DidLink did={attesterDid} maxWidth={620} />
                                </Box>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                                    <FormControl size="small" sx={{ minWidth: 100 }}>
                                        <Select
                                            value={pageSize}
                                            onChange={(event) => updateParams({
                                                pageSize: String(event.target.value),
                                                page: "0",
                                            })}
                                        >
                                            {pageSizeOptions.map((option) => (
                                                <MenuItem key={option} value={option}>
                                                    {option}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <Box display="flex" alignItems="center" gap={1}>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            disabled={page === 0}
                                            onClick={() => updateParams({ page: String(page - 1) })}
                                        >
                                            Prev
                                        </Button>
                                        <Typography>
                                            Page {Math.min(page + 1, totalPages)} / {totalPages}
                                        </Typography>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            disabled={page + 1 >= totalPages}
                                            onClick={() => updateParams({ page: String(page + 1) })}
                                        >
                                            Next
                                        </Button>
                                    </Box>
                                </Box>
                            </Box>

                            {isUsageLoading ? (
                                <Typography>Loading receipt usage...</Typography>
                            ) : usageRows.length === 0 ? (
                                <Typography>No challenge receipt usage found.</Typography>
                            ) : (
                                <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                                    <Table size="small" sx={receiptTableSx}>
                                        <TableHead>
                                            <TableRow>
                                                <SortableHeader
                                                    label="Schema DID"
                                                    sortKey="schemaDid"
                                                    sort={usageSort}
                                                    onSort={toggleUsageSort}
                                                />
                                                <SortableHeader
                                                    label="Requester DID"
                                                    sortKey="requesterDid"
                                                    sort={usageSort}
                                                    onSort={toggleUsageSort}
                                                />
                                                <SortableHeader
                                                    label="Count"
                                                    sortKey="count"
                                                    sort={usageSort}
                                                    onSort={toggleUsageSort}
                                                    sx={compactNumberColumnSx}
                                                />
                                                <SortableHeader
                                                    label="First Updated"
                                                    sortKey="firstUpdatedAt"
                                                    sort={usageSort}
                                                    onSort={toggleUsageSort}
                                                    sx={compactDateColumnSx}
                                                />
                                                <SortableHeader
                                                    label="Last Updated"
                                                    sortKey="lastUpdatedAt"
                                                    sort={usageSort}
                                                    onSort={toggleUsageSort}
                                                    sx={compactDateColumnSx}
                                                />
                                                <TableCell sx={{ width: 96 }}>Receipts</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {pagedUsageRows.map((row) => (
                                                <TableRow
                                                    key={`${row.schemaDid}:${row.requesterDid}`}
                                                    hover
                                                >
                                                    <TableCell>
                                                        <DidLink did={row.schemaDid} />
                                                    </TableCell>
                                                    <TableCell>
                                                        <DidLink did={row.requesterDid} />
                                                    </TableCell>
                                                    <TableCell sx={compactNumberColumnSx}>{row.count}</TableCell>
                                                    <TableCell>{formatTimestamp(row.firstUpdatedAt)}</TableCell>
                                                    <TableCell>{formatTimestamp(row.lastUpdatedAt)}</TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            onClick={() => handleSelectUsageRow(row)}
                                                        >
                                                            View
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </>
                    )}
                </>
            )}
        </Box>
    );
}

export default React.memo(ChallengeReceipts);
