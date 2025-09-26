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
    Tab, FormControl,
} from "@mui/material";
import {
    AddCircleOutline,
    BarChart,
    Block,
    Delete,
    Edit,
    HowToVote,
} from "@mui/icons-material";
import { useWalletContext } from "../contexts/WalletProvider";
import { useCredentialsContext } from "../contexts/CredentialsProvider";
import { useUIContext } from "../contexts/UIContext";
import PollResultsModal from "./PollResultsModal";
import {NoticeMessage, Poll, PollResults} from "@mdip/keymaster/types";
import TextInputModal from "./TextInputModal";
import WarningModal from "./WarningModal";
import CopyResolveDID from "./CopyResolveDID";
import DisplayDID from "./DisplayDID";

const PollsTab: React.FC = () => {
    const {
        currentDID,
        currentId,
        keymaster,
        registries,
        setError,
        setSuccess,
    } = useWalletContext();
    const {
        groupList,
        nameList,
        pollList,
    } = useCredentialsContext();
    const {
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
    const [removeOpen, setRemoveOpen]   = useState(false);
    const [removeName, setRemoveName]   = useState<string>("");
    const [canVote, setCanVote] = useState<boolean>(false);
    const [eligiblePolls, setEligiblePolls] = useState<Record<string, boolean>>({});

    const pollExpired = pollDeadline ? Date.now() > pollDeadline.getTime() : false;
    const selectedPollDid = selectedPollName ? nameList[selectedPollName] ?? "" : "";

    useEffect(() => {
        if (!keymaster || !currentDID || pollList.length === 0) {
            return;
        }

        (async () => {
            const map: Record<string, boolean> = {};

            for (const name of pollList) {
                const did = nameList[name];
                try {
                    const poll= await keymaster.getPoll(did);
                    if (!poll) {
                        map[name] = false;
                        continue;
                    }
                    const group  = await keymaster.getGroup(poll.roster);
                    map[name] = !!group?.members?.includes(currentDID);
                } catch {
                    map[name] = false;
                }
            }
            setEligiblePolls(map);
        })();
    }, [pollList, nameList, keymaster, currentDID]);

    function clearPollList() {
        setSelectedPollName("");
        setSelectedPollDesc("");
        setPollOptions([]);
        setPollResults(null);
        setPollController("");
    }

    useEffect(() => {
        clearPollList();
    }, [currentId]);

    async function confirmRemovePoll() {
        if (!keymaster || !removeName) {
            return;
        }
        try {
            await keymaster.removeName(removeName);
            await refreshNames();
            clearPollList();
            setSuccess(`Removed '${removeName}'`);
        } catch (err: any) {
            setError(err);
        }
        setRemoveOpen(false);
        setRemoveName("");
    }

    const resetForm = () => {
        setPollName("");
        setDescription("");
        setOptionsStr("yes, no, abstain");
        setRosterDid("");
        setDeadline("");
        setCreatedPollDid("");
        setPollNoticeSent(false);
    };

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

                if (poll) {
                    const group = await keymaster.getGroup(poll.roster);
                    const eligible = !!group?.members?.includes(currentDID);
                    setCanVote(eligible);
                }

                if (poll?.results) {
                    setPollResults(poll.results);
                    setPollPublished(true);
                }

                if (currentDID && poll?.ballots && poll.ballots[currentDID]) {
                    const ballotId = poll.ballots[currentDID].ballot;
                    setLastBallotDid(ballotId);
                    setHasVoted(true);
                    setBallotSent(true);
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
            setHasVoted(true);
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
            <WarningModal
                title="Remove Poll"
                warningText={`Are you sure you want to remove '${removeName}'?`}
                isOpen={removeOpen}
                onClose={() => setRemoveOpen(false)}
                onSubmit={confirmRemovePoll}
            />

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

            <Box
                sx={{
                    position: "sticky",
                    top: 0,
                    zIndex: (t) => t.zIndex.appBar,
                    bgcolor: "background.paper",
                    mb: 1
                }}
            >
                <Tabs
                    value={activeTab}
                    onChange={(_, v) => setActiveTab(v)}
                    indicatorColor="primary"
                    textColor="primary"
                >
                    <Tab value="create" label="Create" icon={<AddCircleOutline />} />
                    <Tab value="view" label="View / Vote" icon={<BarChart />} />
                </Tabs>
            </Box>

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
                        <FormControl fullWidth>
                            <Select
                                value={registry}
                                onChange={(e) => setRegistry(e.target.value)}
                                sx={{
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
                        </FormControl>

                        <Button
                            variant="contained"
                            onClick={handleCreatePoll}
                            sx={{
                                borderTopLeftRadius: 0,
                                borderBottomLeftRadius: 0,
                            }}
                            size="large"
                            fullWidth
                            disabled={!pollName || !description || !optionsStr || !rosterDid || !deadline}
                        >
                            Create
                        </Button>
                    </Box>

                    <Box display="flex" flexDirection="row" sx={{ mb: 2, gap: 1, width: "100%" }}>
                        <Button
                            variant="contained"
                            color="secondary"
                            size="large"
                            onClick={handleSendPoll}
                            fullWidth
                            disabled={!createdPollDid || pollNoticeSent || !rosterDid}
                        >
                            Send
                        </Button>

                        <Button
                            variant="outlined"
                            size="large"
                            onClick={resetForm}
                            fullWidth
                        >
                            Clear
                        </Button>
                    </Box>

                    {createdPollDid &&
                        <DisplayDID did={createdPollDid} />
                    }
                </Box>
            )}

            {activeTab === "view" && (
                <Box>
                    {pollList.length > 0 ? (
                        <Box>
                            <Box className="flex-box" sx={{ display: "flex", alignItems: "center", width: "100%", flexWrap: "nowrap" }}>
                                <FormControl sx={{ flex: 1, minWidth: 0 }}>
                                    <Select
                                        value={selectedPollName}
                                        onChange={handleSelectPoll}
                                        displayEmpty
                                        size="small"
                                    >
                                        <MenuItem value="" disabled>
                                            Select poll
                                        </MenuItem>
                                        {pollList.map((name: string) => (
                                            <MenuItem key={name} value={name}>
                                                {eligiblePolls[name] ? (
                                                    <HowToVote fontSize="small" sx={{ mr: 1 }} />
                                                ) : (
                                                    <Block fontSize="small" sx={{ mr: 1 }} />
                                                )}
                                                {name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, whiteSpace: "nowrap" }}>
                                    <Tooltip title="Rename Poll">
                                        <span>
                                            <IconButton
                                                size="small"
                                                onClick={openRenameModal}
                                                disabled={!selectedPollName}
                                            >
                                                <Edit fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>

                                    <Tooltip title="Delete Poll">
                                        <span>
                                            <IconButton
                                                size="small"
                                                disabled={!selectedPollName}
                                                onClick={() => {
                                                    setRemoveName(selectedPollName);
                                                    setRemoveOpen(true);
                                                }}
                                            >
                                                <Delete fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>

                                    <CopyResolveDID did={selectedPollDid} />
                                </Box>
                            </Box>

                            <Box className="flex-box" sx={{ mt: 1 }}>
                                {currentDID && pollController && currentDID === pollController && (
                                    <Box>
                                        {pollExpired && (
                                            <Button
                                                variant="outlined"
                                                size="large"
                                                onClick={handleTogglePublish}
                                            >
                                                {pollPublished ? "Unpublish" : "Publish"}
                                            </Button>
                                        )}

                                        <Button
                                            variant="outlined"
                                            size="large"
                                            sx={{ ml: 1 }}
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
                                    <Typography variant="h6" sx={{ mt: 2 }}>
                                        Description
                                    </Typography>
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

                                            {canVote &&
                                                <Box>
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
                                                        <Box sx={{ mt: 1 }}>
                                                            <DisplayDID did={lastBallotDid} />
                                                        </Box>
                                                    )}
                                                </Box>
                                            }
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
                    ) : (
                        <Box display="flex" width="100%" justifyContent="center" alignItems="center" mt={2}>
                            <Typography variant="h6">No polls found</Typography>
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default PollsTab;
