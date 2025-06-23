import React, {useEffect, useState} from "react";
import {
    Autocomplete,
    Box,
    Button,
    IconButton,
    MenuItem,
    Select,
    SelectChangeEvent,
    TextField,
    Typography,
    RadioGroup,
    Radio,
    FormControlLabel,
    Checkbox,
    Tooltip,
    Tabs,
    Tab,
} from "@mui/material";
import {
    ContentCopy,
    ManageSearch,
    AddCircleOutline,
    BarChart,
    Edit,
} from "@mui/icons-material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import PollResultsModal from "./PollResultsModal";
import {NoticeMessage, Poll, PollResults} from "@mdip/keymaster/types";
import TextInputModal from "../../shared/TextInputModal";

const PollsTab: React.FC = () => {
    const {
        currentDID,
        keymaster,
        registries,
        setError,
        setSuccess,
    } = useWalletContext();
    const {
        groupList,
        nameList,
        pollList,
        setPollList,
        setNameList,
    } = useCredentialsContext();
    const {
        handleCopyDID,
        openBrowserWindow,
        refreshNames
    } = useUIContext();
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [pollName, setPollName] = useState<string>("");
    const [description, setDescription] = useState<string>("");
    const [optionsStr, setOptionsStr] = useState<string>("yes, no, abstain");
    const [rosterDid, setRosterDid] = useState<string>("");
    const [deadline, setDeadline] = useState<string>("");
    const [createdPollDid, setCreatedPollDid] = useState<string>("");
    const [selectedPollName, setSelectedPollName] = useState<string>("");
    const [selectedPollDesc, setSelectedPollDesc] = useState<string>("");
    const [pollOptions, setPollOptions] = useState<string[]>([]);
    const [selectedOptionIdx, setSelectedOptionIdx] = useState<number>(0);
    const [spoil, setSpoil] = useState<boolean>(false);
    const [pollDeadline, setPollDeadline] = useState<Date | null>(null);
    const [pollPublished, setPollPublished] = useState<boolean>(false);
    const [pollController, setPollController] = useState<string>("");
    const [lastBallotDid, setLastBallotDid] = useState<string>("");
    const [hasVoted, setHasVoted] = useState<boolean>(false);
    const [pollResults, setPollResults] = useState<PollResults | null>(null);
    const [resultsOpen, setResultsOpen] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<"create" | "view">("create");
    const [ballotSent, setBallotSent] = useState<boolean>(false);
    const [pollNoticeSent, setPollNoticeSent] = useState<boolean>(false);
    const [renameOpen, setRenameOpen] = useState<boolean>(false);
    const [renameOldName, setRenameOldName] = useState<string>("");

    const pollExpired = pollDeadline ? Date.now() > pollDeadline.getTime() : false;
    const selectedPollDid = selectedPollName ? nameList[selectedPollName] ?? "" : "";

    const resetForm = () => {
        setPollName("");
        setDescription("");
        setOptionsStr("yes, no, abstain");
        setRosterDid("");
        setDeadline("");
        setCreatedPollDid("");
        setPollNoticeSent(false);
    };

    function arraysEqual(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }

    useEffect(() => {
        async function refreshPoll() {
            if (!keymaster) {
                return;
            }

            const walletNames = await keymaster.listNames();
            const names = Object.keys(walletNames);
            names.sort((a, b) => a.localeCompare(b));
            const extraNames: Record<string, string> = {};

            const polls = [];

            for (const name of names) {
                try {
                    const doc = await keymaster.resolveDID(name);
                    const data = doc.didDocumentData as Record<string, unknown>;

                    if (data.poll) {
                        polls.push(name);
                    }
                }
                catch {}
            }

            if (!arraysEqual(polls, pollList)) {
                for (const name of polls) {
                    if (!(name in nameList)) {
                        extraNames[name] = walletNames[name];
                    }
                }

                if (Object.keys(extraNames).length) {
                    setNameList((prev) => ({ ...prev, ...extraNames }));
                }

                setPollList(polls);
            }
        }

        const interval = setInterval(() => {
            refreshPoll();
        }, 30000);

        return () => clearInterval(interval);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster]);

    const buildPoll = async (): Promise<Poll | null> => {
        if (!keymaster) {
            return null;
        }

        const template: Poll = await keymaster.pollTemplate();

        if (!pollName || !pollName.trim()) {
            setError("Poll name is required");
            return null;
        }
        if (pollName in nameList) {
            setError(`Name "${pollName}" is already in use`);
            return null;
        }
        if (!description.trim()) {
            setError("Description is required");
            return null;
        }
        if (!rosterDid.trim()) {
            setError("Roster DID / name is required");
            return null;
        }
        if (!deadline) {
            setError("Deadline is required");
            return null;
        }

        const options = optionsStr
            .split(/[,\n]/)
            .map((o) => o.trim())
            .filter((o) => o.length);

        if (options.length < 2 || options.length > 10) {
            setError("Provide between 2 and 10 options");
            return null;
        }

        const roster = nameList[rosterDid] ?? rosterDid;

        return {
            ...template,
            description: description.trim(),
            roster,
            options,
            deadline: new Date(deadline).toISOString(),
        } as Poll;
    };

    const handleCreatePoll = async () => {
        if (!keymaster) {
            return;
        }

        const poll = await buildPoll();
        if (!poll) {
            return;
        }

        try {
            const did = await keymaster.createPoll(poll, { registry });
            setCreatedPollDid(did);
            setPollNoticeSent(false);
            await keymaster.addName(pollName, did);
            await refreshNames();
            setSuccess(`Poll created: ${did}`);
        } catch (error: any) {
            setError(error);
        }
    };

    const handleSelectPoll = async (event: SelectChangeEvent) => {
        if (!keymaster) {
            return;
        }
        const name = event.target.value;
        setSelectedPollName(name);
        setSelectedPollDesc("");
        setSelectedOptionIdx(0);
        setSpoil(false);
        setHasVoted(false);
        setLastBallotDid("");
        setBallotSent(false);
        setPollController("");
        try {
            const did = nameList[name] ?? "";
            if (did) {
                const poll = await keymaster.getPoll(did);
                setSelectedPollDesc(poll?.description ?? "");
                setPollOptions(poll?.options ?? []);
                setPollDeadline(poll?.deadline ? new Date(poll.deadline) : null);

                const didDoc = await keymaster.resolveDID(did);
                if (didDoc) {
                    setPollController(didDoc.didDocument?.controller ?? "");
                }

                if (poll?.results) {
                    setPollResults(poll.results);
                    setPollPublished(true);
                }

                if (currentDID && poll?.ballots && poll.ballots[currentDID]) {
                    const ballotId = poll.ballots[currentDID].ballot;
                    setLastBallotDid(ballotId);
                    try {
                        const decrypted = await keymaster.decryptJSON(ballotId) as { vote: number };
                        if (decrypted.vote === 0) {
                            setSpoil(true);
                        } else {
                            setSelectedOptionIdx(decrypted.vote - 1);
                        }
                        setHasVoted(true);
                    } catch { }
                }
            }
        } catch (error: any) {
            setError(error);
            setPollOptions([]);
        }
    };

    const handleVote = async () => {
        if (!keymaster || !selectedPollDid) {
            return;
        }
        try {
            const voteVal = selectedOptionIdx + 1;
            const ballotDid = await keymaster.votePoll(
                selectedPollDid,
                voteVal,
                spoil ? { spoil: true } : undefined
            );
            setLastBallotDid(ballotDid);
            if (currentDID && pollController && currentDID === pollController) {
                setBallotSent(true);
                await keymaster.updatePoll(ballotDid);
                setSuccess("Poll updated");
            } else {
                setBallotSent(false);
                setSuccess("Ballot created");
            }

        } catch (error: any) {
            setError(error);
        }
    };

    async function handleSendBallot() {
        if (!keymaster || !lastBallotDid || !pollController) {
            return;
        }
        try {
            const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            const message: NoticeMessage = { to: [pollController], dids: [lastBallotDid] };
            const notice = await keymaster.createNotice(message, {
                registry: "hyperswarm",
                validUntil,
            });
            if (notice) {
                setSuccess("Ballot sent");
                setBallotSent(true);
            } else {
                setError("Failed to send ballot");
            }
        } catch (error: any) {
            setError(error);
        }
    }

    const handleTogglePublish = async () => {
        if (!keymaster || !selectedPollDid) {
            return;
        }

        try {
            if (pollPublished) {
                await keymaster.unpublishPoll(selectedPollDid);
                setPollPublished(false);
                setPollResults(null);
                setSuccess("Poll unpublished");
            } else {
                await keymaster.publishPoll(selectedPollDid);
                const poll = await keymaster.getPoll(selectedPollDid);
                if (poll?.results) {
                    setPollResults(poll.results);
                }
                setPollPublished(true);
                setSuccess("Poll published");
            }
        } catch (error: any) {
            setError(error);
        }
    };

    const handleViewPoll = async () => {
        if (!keymaster || !selectedPollDid) {
            return;
        }
        try {
            const view = await keymaster.viewPoll(selectedPollDid);
            if (view.results) {
                setPollResults(view.results);
                setResultsOpen(true);
            }
        } catch (error: any) {
            setError(error);
        }
    };

    async function handleSendPoll() {
        if (!keymaster || !createdPollDid) {
            return;
        }

        try {
            const group = await keymaster.getGroup(nameList[rosterDid] ?? rosterDid);
            if (!group || group.members.length === 0) {
                setError("Group not found or empty");
                return;
            }
            const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            const message: NoticeMessage = { to: group.members, dids: [createdPollDid] };
            const noticeDid = await keymaster.createNotice(message, {
                registry: "hyperswarm",
                validUntil,
            });

            if (noticeDid) {
                setSuccess("Poll notice sent");
                setPollNoticeSent(true);
            } else {
                setError("Failed to send poll");
            }
        } catch (error: any) {
            setError(error);
        }
    }

    const openRenameModal = () => {
        setRenameOldName(selectedPollName);
        setRenameOpen(true);
    };

    const handleRenameSubmit = async (newName: string) => {
        setRenameOpen(false);
        if (!newName || newName === selectedPollName || !keymaster) {
            return;
        }

        try {
            await keymaster.addName(newName, selectedPollDid);
            await keymaster.removeName(selectedPollName);
            await refreshNames();
            setSelectedPollName(newName);
            setRenameOldName("");
            setSuccess("Poll renamed");
        } catch (err: any) {
            setError(err);
        }
    }


    return (
        <Box>
            {pollResults && (
                <PollResultsModal
                    open={resultsOpen}
                    onClose={() => setResultsOpen(false)}
                    results={pollResults}
                />
            )}

            <TextInputModal
                isOpen={renameOpen}
                title="Rename Poll"
                description={`Rename '${renameOldName}' to:`}
                label="New Name"
                confirmText="Rename"
                defaultValue={renameOldName}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                indicatorColor="primary"
                textColor="primary"
                sx={{ mb: 2 }}
            >
                <Tab value="create" label="Create Poll" icon={<AddCircleOutline />} />
                <Tab value="view" label="View Poll" icon={<BarChart />} />
            </Tabs>

            {activeTab === "create" && (
                <Box>
                    <TextField
                        fullWidth
                        label="Poll Name"
                        value={pollName}
                        onChange={(e) => setPollName(e.target.value)}
                        sx={{ mb: 2 }}
                        slotProps={{
                            htmlInput: {
                                maxLength: 32,
                            },
                        }}
                    />

                    <TextField
                        fullWidth
                        label="Description"
                        multiline
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        sx={{ mb: 2 }}
                        slotProps={{
                            htmlInput: {
                                maxLength: 200,
                            },
                        }}
                    />

                    <TextField
                        fullWidth
                        label="Options (comma‑separated)"
                        value={optionsStr}
                        onChange={(e) => setOptionsStr(e.target.value)}
                        sx={{ mb: 2 }}
                        helperText="Between 2 and 10 options"
                    />

                    <Autocomplete
                        freeSolo
                        options={groupList}
                        value={rosterDid}
                        onInputChange={(_e, value) => setRosterDid(value.trim())}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                label="Group DID or Name"
                                placeholder="did:test:... or friendly‑name"
                                sx={{ mb: 2 }}
                            />
                        )}
                    />

                    <TextField
                        fullWidth
                        type="datetime-local"
                        label="Deadline"
                        slotProps={{ inputLabel: { shrink: true } }}
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                        sx={{ mb: 2 }}
                    />

                    <Box className="flex-box" sx={{ mb: 2 }}>
                        <Select
                            value={registry}
                            onChange={(e) => setRegistry(e.target.value)}
                            sx={{
                                minWidth: 300,
                                borderTopRightRadius: 0,
                                borderBottomRightRadius: 0,
                            }}
                        >
                            {registries.map((r) => (
                                <MenuItem key={r} value={r}>
                                    {r}
                                </MenuItem>
                            ))}
                        </Select>

                        <Button
                            variant="contained"
                            onClick={handleCreatePoll}
                            sx={{
                                height: 56,
                                borderTopLeftRadius: 0,
                                borderBottomLeftRadius: 0,
                            }}
                            disabled={!pollName || !description || !optionsStr || !rosterDid || !deadline}
                        >
                            Create
                        </Button>

                        <Button
                            variant="contained"
                            color="secondary"
                            sx={{ height: 56, ml: 1 }}
                            onClick={handleSendPoll}
                            disabled={!createdPollDid || pollNoticeSent || !rosterDid}
                        >
                            Send
                        </Button>

                        <Button
                            variant="outlined"
                            sx={{ height: 56, ml: 1 }}
                            onClick={resetForm}
                        >
                            Clear
                        </Button>
                    </Box>

                    {createdPollDid && (
                        <Box display="flex" alignItems="center" mt={2}>
                            <Typography variant="body2" sx={{ mr: 1 }}>
                                {createdPollDid}
                            </Typography>
                            <IconButton onClick={() => handleCopyDID(createdPollDid)} size="small" sx={{ px: 0.5 }}>
                                <ContentCopy fontSize="small" />
                            </IconButton>
                        </Box>
                    )}
                </Box>
            )}

            {activeTab === "view" && (
                <Box>
                    {pollList.length > 0 && (
                        <Box sx={{ mt: 2 }}>
                            <Box className="flex-box">
                                <Select
                                    value={selectedPollName}
                                    onChange={handleSelectPoll}
                                    displayEmpty
                                    sx={{ minWidth: 220 }}
                                >
                                    <MenuItem value="" disabled>
                                        Select poll
                                    </MenuItem>
                                    {pollList.map((name: string) => (
                                        <MenuItem key={name} value={name}>
                                            {name}
                                        </MenuItem>
                                    ))}
                                </Select>

                                <Tooltip title="Rename Poll">
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={openRenameModal}
                                            disabled={!selectedPollName}
                                            sx={{ mt: 1, ml: 1, px: 0.5 }}
                                        >
                                            <Edit fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>

                                <Tooltip title="Copy DID">
                                    <span>
                                        <IconButton
                                            onClick={() => handleCopyDID(selectedPollDid)}
                                            size="small"
                                            sx={{ mt: 1, ml: 1, px: 0.5 }}
                                            disabled={!selectedPollDid}
                                        >
                                            <ContentCopy fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>

                                <Tooltip title="Resolve DID">
                                    <span>
                                        <IconButton
                                            onClick={() => openBrowserWindow({ did: selectedPollDid })}
                                            size="small"
                                            disabled={!selectedPollDid}
                                            sx={{ mt: 1, ml: 1, px: 0.5 }}
                                        >
                                            <ManageSearch fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>

                                {currentDID && pollController && currentDID === pollController && (
                                    <Box>
                                        {pollExpired && (
                                            <Button
                                                variant="outlined"
                                                sx={{ height: 56 }}
                                                onClick={handleTogglePublish}
                                            >
                                                {pollPublished ? "Unpublish" : "Publish"}
                                            </Button>
                                        )}

                                        <Button
                                            variant="outlined"
                                            sx={{ height: 56, ml: 1 }}
                                            onClick={handleViewPoll}
                                            disabled={!selectedPollDid}
                                        >
                                            View
                                        </Button>
                                    </Box>
                                )}
                            </Box>

                            {selectedPollDid && (
                                <Box>
                                    <Typography variant="body1" sx={{ mt: 2 }}>
                                        {selectedPollDesc}
                                    </Typography>

                                    {!pollExpired ? (
                                        <Box mt={2}>
                                            {!hasVoted ? (
                                                <Typography variant="h6">Cast your vote</Typography>
                                            ) : (
                                                <Typography variant="h6">Update your vote</Typography>
                                            )}

                                            {pollDeadline && (
                                                <Typography
                                                    variant="body2"
                                                    sx={{ mt: 1, color: pollExpired ? "error.main" : "text.secondary" }}
                                                >
                                                    Deadline: {pollDeadline.toLocaleString()}
                                                </Typography>
                                            )}

                                            {!spoil && (
                                                <RadioGroup
                                                    value={selectedOptionIdx}
                                                    onChange={(_, val) => setSelectedOptionIdx(Number(val))}
                                                >
                                                    {pollOptions.map((opt, idx) => (
                                                        <FormControlLabel
                                                            key={idx}
                                                            value={idx}
                                                            control={<Radio />}
                                                            label={opt}
                                                        />
                                                    ))}
                                                </RadioGroup>
                                            )}

                                            <FormControlLabel
                                                control={<Checkbox checked={spoil} onChange={(_, v) => setSpoil(v)} />}
                                                label="Spoil ballot"
                                            />

                                            <Button
                                                variant="contained"
                                                sx={{ height: 56 }}
                                                onClick={handleVote}
                                            >
                                                Vote
                                            </Button>

                                            {currentDID !== pollController && (
                                                <Button
                                                    variant="contained"
                                                    color="secondary"
                                                    sx={{ height: 56, ml: 1 }}
                                                    disabled={!lastBallotDid || ballotSent}
                                                    onClick={handleSendBallot}
                                                >
                                                    Send Ballot
                                                </Button>
                                            )}

                                            {lastBallotDid && (
                                                <Box display="flex" alignItems="center" mt={1}>
                                                    <Typography variant="body2" sx={{ mr: 1 }}>
                                                        Ballot: {lastBallotDid}
                                                    </Typography>
                                                    <IconButton
                                                        onClick={() => handleCopyDID(lastBallotDid)}
                                                        size="small"
                                                        sx={{ px: 0.5 }}
                                                    >
                                                        <ContentCopy fontSize="small" />
                                                    </IconButton>
                                                </Box>
                                            )}
                                        </Box>
                                    ) : (
                                        <Box mt={2}>
                                            <Typography variant="h6" sx={{ mt: 1, mb: 1 }}>
                                                Poll complete
                                            </Typography>
                                            {pollPublished ? (
                                                <Button
                                                    variant="outlined"
                                                    onClick={() => setResultsOpen(true)}
                                                    sx={{
                                                        height: 56
                                                    }}
                                                >
                                                    View Results
                                                </Button>
                                            ) : (
                                                <Typography variant="body1">
                                                    Results not published yet
                                                </Typography>
                                            )}
                                        </Box>
                                    )}
                                </Box>
                            )}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default PollsTab;
